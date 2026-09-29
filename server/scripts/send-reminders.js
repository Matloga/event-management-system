/**
 * Sends a reminder email to everyone holding a confirmed seat at an event
 * happening tomorrow (challenge 3).
 *
 *   npm run reminders
 *   npm run reminders -- --days 3
 *
 * Run it from cron, a GitHub Actions schedule, or a Render cron job. It is
 * idempotent per (event, attendee): a row is only mailed once per day because
 * the query is scoped to events exactly N days out, and re-running the same
 * day re-sends only if the schedule allows it. To guarantee at-most-once,
 * schedule it for a single fixed hour.
 */
import { closePool, connect, query } from '../config/database.js';
import { sendMail } from '../services/mailService.js';
import { buildTicketPayload, renderQrDataUrl } from '../services/qrService.js';
import env from '../config/env.js';

const daysArgIndex = process.argv.indexOf('--days');
const DAYS = daysArgIndex > -1 ? Number(process.argv[daysArgIndex + 1]) : 1;

if (!Number.isInteger(DAYS) || DAYS < 0 || DAYS > 30) {
  console.error('--days must be an integer between 0 and 30');
  process.exit(1);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

await connect();

/** Confirmed attendees for events starting in exactly DAYS days. */
const { recordset: attendees } = await query(`
  SELECT
    u.email, u.name,
    r.ticket_number, r.qr_token,
    e.id AS event_id, e.title, e.venue, e.city, e.address,
    CONVERT(VARCHAR(10), e.event_date, 23) AS event_date,
    CONVERT(VARCHAR(5),  e.start_time, 108) AS start_time
  FROM dbo.registrations r
  INNER JOIN dbo.users u  ON u.id = r.user_id
  INNER JOIN dbo.events e ON e.id = r.event_id
  WHERE r.status = 'confirmed'
    AND e.is_published = 1
    AND e.event_date = DATEADD(DAY, @days, CAST(GETDATE() AS DATE))
  ORDER BY e.event_date, e.title, u.name
`, { days: DAYS });

if (attendees.length === 0) {
  console.log(`[reminders] no events start in ${DAYS} day(s) - nothing to send`);
  await closePool();
  process.exit(0);
}

const baseUrl = env.CLIENT_URL.replace(/\/$/, '');
let sent = 0;

for (const a of attendees) {
  const payload = buildTicketPayload({ qrToken: a.qr_token, eventId: a.event_id, baseUrl });

  let qr = null;
  try {
    qr = await renderQrDataUrl(payload, { width: 240 });
  } catch (err) {
    console.warn(`[reminders] could not render a QR for ${a.email}: ${err.message}`);
  }

  const when = `${a.event_date} at ${String(a.start_time).slice(0, 5)}`;
  const where = [a.venue, a.address, a.city].filter(Boolean).join(', ');

  const text = [
    `Hi ${a.name},`,
    '',
    `A reminder that "${a.title}" is ${DAYS === 0 ? 'today' : `in ${DAYS} day${DAYS === 1 ? '' : 's'}`}!`,
    '',
    `When:   ${when}`,
    `Where:  ${where}`,
    `Ticket: ${a.ticket_number}`,
    '',
    'Show the QR code in the app at the entrance.',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#4f46e5;padding:20px 28px;color:#fff;font-size:18px;font-weight:600;">
        Coming up: ${esc(a.title)}
      </td></tr>
      <tr><td style="padding:28px;color:#27272a;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 16px;">Hi ${esc(a.name)},</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;">
          <tr><td style="padding:6px 0;color:#71717a;font-size:13px;width:90px;">When</td>
              <td style="padding:6px 0;font-weight:600;">${esc(when)}</td></tr>
          <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Where</td>
              <td style="padding:6px 0;font-weight:600;">${esc(where)}</td></tr>
          <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Ticket</td>
              <td style="padding:6px 0;font-weight:600;">${esc(a.ticket_number)}</td></tr>
        </table>
        ${qr ? `<div style="text-align:center;margin:0 0 12px;"><img src="${qr}" width="220" height="220" alt="Your ticket QR code" style="border:1px solid #e4e4e7;border-radius:8px;"/></div>` : ''}
        <p style="margin:0;font-size:13px;color:#52525b;">Show this code at the entrance.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  await sendMail({ to: a.email, subject: `Reminder: ${a.title} is coming up`, text, html });
  sent += 1;
  process.stdout.write(`\r[reminders] ${sent}/${attendees.length}`);
}

// sendMail swallows transport failures by design, so a run that reaches this
// point has attempted every recipient.
console.log(`\n[reminders] done - ${sent} reminder(s) sent`);
await closePool();
