import env from '../config/env.js';
import {
  cancelRegistration,
  checkInTicket,
  findTicketByToken,
  findTicketForUser,
  getEventRegistrationStats,
  listEventAttendees,
  listMyTickets,
  registerForEvent,
} from '../models/registrationModel.js';
import { getEventById } from '../models/eventModel.js';
import { query } from '../config/database.js';
import { attendeesToCsv, csvFilename } from '../services/csvService.js';
import {
  sendConfirmationEmail,
  sendRegistrationCancelledEmail,
  sendWaitlistPromotionEmail,
  sendWaitlistedEmail,
} from '../services/mailService.js';
import { buildTicketPayload, parseTicketInput, renderQrSvg } from '../services/qrService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, conflict, notFound, unprocessable } from '../utils/errors.js';
import { pageMeta, sendData } from '../utils/http.js';
import { assertCanManage } from './eventController.js';

/** Result codes from sp_register_for_event -> HTTP. */
const REGISTRATION_OUTCOMES = {
  duplicate: () => conflict('You are already registered for this event', 'already_registered'),
  full: () => conflict('This event is fully booked. Join the waitlist instead.', 'event_full'),
  unpublished: () => notFound('Event not found'),
  not_found: () => notFound('Event not found'),
  not_allowed: () => notFound('Event not found'),
};

/** Where waitlist place in line is this user? 1 = next in line. */
async function waitlistPosition(eventId, userId) {
  const result = await query(
    `SELECT
       (SELECT COUNT_BIG(*) FROM dbo.registrations a
         JOIN dbo.registrations b
           ON b.event_id = a.event_id AND b.status = 'waitlisted'
          AND (b.registered_at < a.registered_at
               OR (b.registered_at = a.registered_at AND b.id < a.id))
        WHERE a.event_id = @eventId AND a.user_id = @userId AND a.status = 'waitlisted') + 1 AS position
     FROM dbo.users WHERE id = @userId`,
    { eventId, userId }
  );
  return Number(result.recordset[0]?.position ?? 1);
}

/**
 * POST /api/events/:eventId/register
 * Body: { waitlist?: boolean }
 */
export const register = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const allowWaitlist = Boolean(req.body?.waitlist);

  const outcome = await registerForEvent({
    eventId,
    userId: req.user.id,
    allowWaitlist,
  });

  const failure = REGISTRATION_OUTCOMES[outcome.result];
  if (failure) throw failure();

  const ticket = await findTicketForUser({ eventId, userId: req.user.id });
  const stats = await getEventRegistrationStats(eventId);

  if (outcome.result === 'waitlisted') {
    const position = await waitlistPosition(eventId, req.user.id);
    await sendWaitlistedEmail({
      to: req.user.email,
      name: req.user.name,
      event: ticket.event,
      position,
    });
    return sendData(
      res,
      { ticket, position, status: 'waitlisted' },
      { status: 201 }
    );
  }

  // Encodes the web app's scanner page, because that is what the attendee's
  // phone camera opens.
  const qrPayload = buildTicketPayload({
    qrToken: outcome.qrToken,
    eventId,
    baseUrl: env.clientUrl,
  });

  // Fire and forget: a mail outage must not undo a successful booking.
  sendConfirmationEmail({
    to: req.user.email,
    name: req.user.name,
    ticketNumber: outcome.ticketNumber,
    event: ticket.event,
    qrPayloadUrl: qrPayload,
  });

  return sendData(
    res,
    {
      ticket,
      status: 'confirmed',
      seatsLeft: Math.max(0, ticket.event.capacity - stats.confirmed),
      qrPayload,
    },
    { status: 201 }
  );
});

/** DELETE /api/events/:eventId/register - cancel the caller's registration. */
export const cancel = asyncHandler(async (req, res) => {
  const { eventId } = req.params;

  const existing = await findTicketForUser({ eventId, userId: req.user.id });
  if (!existing) throw notFound('You are not registered for this event');

  const outcome = await cancelRegistration({
    eventId,
    userId: req.user.id,
    actorId: req.user.id,
    isAdmin: req.user.role === 'admin',
  });

  if (outcome.result === 'not_found') {
    throw conflict('Only a confirmed seat can be cancelled', 'not_confirmed');
  }
  if (outcome.result === 'not_allowed') {
    throw notFound('You are not registered for this event');
  }

  sendRegistrationCancelledEmail({
    to: req.user.email,
    name: req.user.name,
    event: existing.event,
  });

  // A seat just freed up - tell the waitlisted attendee they are in.
  if (outcome.promotedTicketNumber) {
    const promoted = await query(
      `SELECT r.qr_token, r.ticket_number, u.email, u.name,
              e.title, CONVERT(VARCHAR(10), e.event_date, 23) AS event_date,
              CONVERT(VARCHAR(5), e.start_time, 108)  AS start_time,
              e.venue, e.city
         FROM dbo.registrations r
         INNER JOIN dbo.users u  ON u.id = r.user_id
         INNER JOIN dbo.events e ON e.id = r.event_id
        WHERE r.ticket_number = @ticket`,
      { ticket: outcome.promotedTicketNumber }
    );
    const row = promoted.recordset[0];
    if (row) {
      sendWaitlistPromotionEmail({
        to: row.email,
        name: row.name,
        ticketNumber: row.ticket_number ?? outcome.promotedTicketNumber,
        event: {
          title: row.title,
          date: String(row.event_date).slice(0, 10),
          startTime: String(row.start_time).slice(0, 5),
          venue: row.venue,
          city: row.city,
        },
      });
    }
  }

  return sendData(res, {
    cancelled: true,
    promotedTicketNumber: outcome.promotedTicketNumber,
    stats: await getEventRegistrationStats(eventId),
  });
});

/** GET /api/registrations/mine?scope=upcoming|past|all */
export const myTickets = asyncHandler(async (req, res) => {
  const scope = ['upcoming', 'past', 'all'].includes(req.query.scope) ? req.query.scope : 'all';
  const tickets = await listMyTickets(req.user.id, { scope, includeQrToken: false });
  return sendData(res, tickets, { meta: { scope, total: tickets.length } });
});

/** GET /api/registrations/:eventId - the caller's ticket, including the QR token. */
export const myTicket = asyncHandler(async (req, res) => {
  const ticket = await findTicketForUser({
    eventId: req.params.eventId,
    userId: req.user.id,
  });
  if (!ticket) throw notFound('You are not registered for this event');
  return sendData(res, ticket);
});

/** GET /api/registrations/:eventId/qr.svg - the scannable ticket. */
export const ticketQr = asyncHandler(async (req, res) => {
  const ticket = await findTicketForUser({
    eventId: req.params.eventId,
    userId: req.user.id,
  });
  if (!ticket) throw notFound('You are not registered for this event');
  if (ticket.status === 'cancelled') throw badRequest('This ticket was cancelled', 'ticket_cancelled');

  const payload = buildTicketPayload({
    qrToken: ticket.qrToken,
    eventId: req.params.eventId,
    baseUrl: env.clientUrl,
  });

  const svg = await renderQrSvg(payload);
  res.type('image/svg+xml');
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.send(svg);
});

/** GET /api/events/:eventId/attendees - organiser / admin. */
export const attendees = asyncHandler(async (req, res) => {
  await assertCanManage(req.params.eventId, req);

  const { status, search, page, limit } = req.query;
  const { rows, total } = await listEventAttendees({ eventId: req.params.eventId, status, search, page, limit });
  const stats = await getEventRegistrationStats(req.params.eventId);

  return sendData(res, { attendees: rows, stats }, { meta: pageMeta({ page, limit, total }) });
});

/** GET /api/events/:eventId/attendees.csv - challenge 9. */
export const attendeesCsv = asyncHandler(async (req, res) => {
  await assertCanManage(req.params.eventId, req);

  const event = await getEventById(req.params.eventId, {
    viewerId: req.user.id,
    isAdmin: req.user.role === 'admin',
  });
  if (!event) throw notFound('Event not found');

  // Exports ignore paging: the organiser asked for the whole list.
  const { rows } = await listEventAttendees({
    eventId: req.params.eventId,
    status: req.query.status ?? 'all',
    search: req.query.search,
    page: 1,
    limit: 100000,
  });

  const csv = attendeesToCsv(rows, { eventTitle: event.title });
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(event.title)}-attendees.csv"`);
  return res.send(csv);
});

/** POST /api/registrations/check-in - redeems a scanned QR token. */
export const checkIn = asyncHandler(async (req, res) => {
  // Accepts a bare token or a full ticket link, since a camera hands over the
  // whole URL and an organiser working from a manifest types the token.
  const { token, eventId: claimedEventId } = parseTicketInput(req.body?.token);
  if (!token) {
    throw badRequest('A QR token is required', 'missing_token');
  }

  // Resolve the token, then authorise against the event the ticket ACTUALLY
  // belongs to - never the event the client claimed. Both steps happen before
  // anything is written, so an organiser scanning somebody else's door gets a
  // 403 without having marked that attendee in.
  const ticket = await findTicketByToken({ qrToken: token });
  if (!ticket) throw notFound('That ticket code is not recognised', 'invalid_token');

  await assertCanManage(ticket.eventId, req);

  // A claimed event is only a hint from the link, used to tell the organiser
  // "that attendee is booked somewhere else" instead of silently checking in
  // somebody who is not on this door's list. Compared case-insensitively,
  // because GUIDs are not case-sensitive and a hand-edited link may differ.
  if (claimedEventId && claimedEventId.toLowerCase() !== String(ticket.eventId).toLowerCase()) {
    throw unprocessable('This ticket belongs to a different event', 'wrong_event');
  }

  // Pass the authorised event so the procedure re-checks it against the token
  // it is about to update, closing the gap between the two statements.
  const outcome = await checkInTicket({ qrToken: token, eventId: ticket.eventId });

  switch (outcome.result) {
    case 'ok':
      return sendData(res, { checkedIn: true, ...outcome });
    case 'already':
      return sendData(res, { checkedIn: true, alreadyCheckedIn: true, ...outcome });
    case 'wrong_event':
      throw unprocessable('This ticket belongs to a different event', 'wrong_event');
    case 'cancelled':
      throw conflict('That registration was cancelled', 'ticket_cancelled');
    case 'waitlisted':
      throw conflict('That attendee is still on the waitlist', 'ticket_waitlisted');
    default:
      throw notFound('That ticket code is not recognised', 'invalid_token');
  }
});
