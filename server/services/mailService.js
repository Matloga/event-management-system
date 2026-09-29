import nodemailer from 'nodemailer';
import env from '../config/env.js';

/**
 * Transactional email.
 *
 * Three drivers:
 *   smtp    - a real SMTP relay (Gmail app password, Mailtrap, SES, ...)
 *   json    - writes the rendered message to stdout as JSON; used by the
 *             test suite to assert on content without sending anything
 *   console - dev default, prints a compact summary
 *
 * Registration emails are fire-and-forget from the caller's point of view:
 * a mail outage must never roll back a successful registration.
 */

let transporter = null;
const outbox = [];

function buildTransport() {
  if (env.MAIL_DRIVER === 'smtp') {
    if (!env.SMTP_HOST) {
      throw new Error('MAIL_DRIVER=smtp requires SMTP_HOST');
    }
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return nodemailer.createTransport({ jsonTransport: true });
}

function getTransport() {
  if (!transporter) transporter = buildTransport();
  return transporter;
}

const from = { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM };

/** @returns {Promise<void>} never rejects - callers fire and forget. */
export async function sendMail(message) {
  const payload = { from, ...message };
  try {
    const info = await getTransport().sendMail(payload);
    if (env.MAIL_DRIVER === 'json') {
      outbox.push({ ...payload, envelope: info?.envelope });
      if (outbox.length > 50) outbox.shift();
    } else if (env.MAIL_DRIVER === 'console') {
      console.log(`[mail:console] to=${payload.to} subject="${payload.subject}"`);
    }
  } catch (err) {
    console.error(`[mail] failed to send "${payload.subject}" to ${payload.to}:`, err.message);
  }
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const shell = (title, bodyHtml) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr><td style="background:#4f46e5;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:600;">
          ${escapeHtml(title)}
        </td></tr>
        <tr><td style="padding:28px;color:#27272a;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#fafafa;color:#71717a;font-size:12px;border-top:1px solid #e4e4e7;">
          ${escapeHtml(env.MAIL_FROM_NAME)} &middot; you are receiving this because you hold an account on the platform.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

const detailRow = (label, value) =>
  `<tr><td style="padding:6px 0;color:#71717a;font-size:13px;width:110px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;color:#18181b;font-size:14px;font-weight:600;">${escapeHtml(value)}</td></tr>`;

/**
 * Registration confirmation: event details + ticket number.
 * @param {{to:string, name:string, ticketNumber:string, event:{title,date,startTime,venue,address,city}, qrPayloadUrl?:string}} input
 */
export async function sendConfirmationEmail({ to, name, ticketNumber, event, qrPayloadUrl }) {
  const when = `${event.date} at ${event.startTime}`;
  const where = [event.venue, event.address, event.city].filter(Boolean).join(', ');

  const html = shell(
    'You are going!',
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
     <p style="margin:0 0 20px;">
       Your place at <strong>${escapeHtml(event.title)}</strong> is confirmed.
       Show the ticket number below at the entrance.
     </p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;">
       ${detailRow('Ticket', ticketNumber)}
       ${detailRow('Date', when)}
       ${detailRow('Venue', where)}
     </table>
     <p style="margin:0 0 8px;font-size:13px;color:#52525b;">
       Your QR ticket is available in the app under <strong>My tickets</strong>.
     </p>
     ${qrPayloadUrl
        ? `<p style="margin:0;font-size:12px;color:#a1a1aa;word-break:break-all;">${escapeHtml(qrPayloadUrl)}</p>`
        : ''}`
  );

  await sendMail({
    to,
    subject: `Confirmed: ${event.title} - ticket ${ticketNumber}`,
    text: [
      `Hi ${name},`,
      ``,
      `Your place at "${event.title}" is confirmed.`,
      ``,
      `Ticket:   ${ticketNumber}`,
      `Date:     ${when}`,
      `Venue:    ${where}`,
      ``,
      `Show the ticket number at the entrance.`,
    ].join('\n'),
    html,
  });
}

/** Sent when a cancelled seat frees up and a waitlisted attendee is promoted. */
export async function sendWaitlistPromotionEmail({ to, name, ticketNumber, event }) {
  const html = shell(
    'You are off the waitlist',
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
     <p style="margin:0 0 20px;">
       A seat opened up and it is now yours for
       <strong>${escapeHtml(event.title)}</strong> on <strong>${escapeHtml(event.date)}</strong>.
     </p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
       ${detailRow('Ticket', ticketNumber)}
       ${detailRow('Date', `${event.date} at ${event.startTime}`)}
       ${detailRow('Venue', [event.venue, event.city].filter(Boolean).join(', '))}
     </table>`
  );

  await sendMail({
    to,
    subject: `You're in: ${event.title}`,
    text: `Hi ${name},\n\nA seat opened up for "${event.title}" and it is now yours.\n\nTicket: ${ticketNumber}\nDate:   ${event.date} at ${event.startTime}\n`,
    html,
  });
}

export async function sendWaitlistedEmail({ to, name, event, position }) {
  const html = shell(
    'You are on the waitlist',
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
     <p style="margin:0 0 20px;">
       <strong>${escapeHtml(event.title)}</strong> is full, so you are number
       ${escapeHtml(position)} on the waitlist. If someone cancels we will email you a ticket
       automatically.
     </p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
       ${detailRow('Date', `${event.date} at ${event.startTime}`)}
       ${detailRow('Venue', [event.venue, event.city].filter(Boolean).join(', '))}
     </table>`
  );

  await sendMail({
    to,
    subject: `Waitlisted: ${event.title}`,
    text: `Hi ${name},\n\n"${event.title}" is full and you are number ${position} on the waitlist.\n`,
    html,
  });
}

export async function sendRegistrationCancelledEmail({ to, name, event }) {
  await sendMail({
    to,
    subject: `Registration cancelled: ${event.title}`,
    text: `Hi ${name},\n\nYour registration for "${event.title}" has been cancelled.\nYou can re-register while seats remain.\n`,
    html: shell(
      'Registration cancelled',
      `<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
       <p style="margin:0;">Your registration for <strong>${escapeHtml(event.title)}</strong>
       on ${escapeHtml(event.date)} has been cancelled. You can register again while seats remain.</p>`
    ),
  });
}

/** Test helper: everything the json driver has "sent" this process. */
export function getOutbox() {
  return outbox;
}

export function clearOutbox() {
  outbox.length = 0;
}
