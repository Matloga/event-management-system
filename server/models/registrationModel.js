import { query } from '../config/database.js';
import { hm, isoDate, num, ymd } from './mappers.js';

/**
 * Registration data access.
 *
 * All *mutations* of a registration go through the stored procedures in
 * sql/002_procedures.sql, which own the transaction and the locking.
 * This module only reads, plus the thin wrappers that call the procs.
 */

const SELECT_TICKET = `
    SELECT
      r.id,
      r.event_id,
      r.user_id,
      r.status,
      r.ticket_number,
      r.qr_token,
      r.checked_in_at,
      CONVERT(VARCHAR(10), r.registered_at, 126) AS registered_at,
      r.cancelled_at,
      e.title        AS event_title,
      e.description  AS event_description,
      e.venue        AS venue,
      e.address      AS address,
      e.city         AS city,
      e.country      AS country,
      e.image_url    AS image_url,
      e.capacity     AS capacity,
      CONVERT(VARCHAR(10), e.event_date, 23) AS event_date,
      CONVERT(VARCHAR(5),  e.start_time, 108) AS start_time,
      CONVERT(VARCHAR(5),  e.end_time,   108) AS end_time,
      o.name         AS organizer_name,
      c.name         AS category_name,
      c.slug         AS category_slug,
      c.accent       AS category_accent,
      u.name         AS attendee_name,
      u.email        AS attendee_email
    FROM dbo.registrations r
    INNER JOIN dbo.events e     ON e.id = r.event_id
    INNER JOIN dbo.users o      ON o.id = e.organizer_id
    INNER JOIN dbo.categories c ON c.id = e.category_id
    INNER JOIN dbo.users u      ON u.id = r.user_id
`;

function toTicket(row, { includeQrToken = false } = {}) {
  if (!row) return null;
  const capacity = Number(row.capacity);
  // checked_in_at is a timestamp, not a BIT: "checked in" simply means the
  // column is set, so this must not go through the BIT coercion.
  const checkedInAt = isoDate(row.checked_in_at);
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    status: String(row.status).toLowerCase(),
    ticketNumber: row.ticket_number,
    checkedInAt,
    isCheckedIn: checkedInAt !== null,
    registeredAt: isoDate(row.registered_at),
    cancelledAt: isoDate(row.cancelled_at),
    attendee: { name: row.attendee_name, email: row.attendee_email },
    event: {
      id: row.event_id,
      title: row.event_title,
      description: row.event_description,
      date: ymd(row.event_date),
      startTime: hm(row.start_time),
      endTime: hm(row.end_time),
      venue: row.venue,
      address: row.address ?? null,
      city: row.city,
      country: row.country,
      imageUrl: row.image_url ?? null,
      capacity,
      category: { name: row.category_name, slug: row.category_slug, accent: row.category_accent },
      organizerName: row.organizer_name,
    },
    // The QR payload is only ever sent to the ticket holder.
    ...(includeQrToken ? { qrToken: row.qr_token } : {}),
  };
}

export { toTicket };

/**
 * Register the authenticated user for an event.
 * @returns {Promise<{result:string, registrationId?:string, ticketNumber?:string, qrToken?:string, event:object}>}
 */
export async function registerForEvent({ eventId, userId, allowWaitlist = false }) {
  const result = await query(
    `EXEC dbo.sp_register_for_event @EventId = @eventId, @UserId = @userId, @AllowFull = @allowFull`,
    { eventId, userId, allowFull: allowWaitlist ? 1 : 0 }
  );
  const row = result.recordset[0] ?? {};
  return {
    result: String(row.result_code ?? 'full').toLowerCase(),
    registrationId: row.registration_id ?? null,
    ticketNumber: row.ticket_number ?? null,
    qrToken: row.qr_token ?? null,
    event: {
      title: row.event_title ?? null,
      date: ymd(row.event_date),
      venue: row.venue ?? null,
      city: row.city ?? null,
    },
  };
}

/**
 * Cancel a confirmed registration. The actor must be the attendee, the event
 * organizer, or an admin - the stored procedure enforces this.
 */
export async function cancelRegistration({ eventId, userId, actorId, isAdmin = false }) {
  const result = await query(
    `EXEC dbo.sp_cancel_registration @EventId = @eventId, @UserId = @userId,
                                      @ActorId = @actorId, @IsAdmin = @isAdmin`,
    { eventId, userId, actorId, isAdmin: isAdmin ? 1 : 0 }
  );
  const row = result.recordset[0] ?? {};
  return {
    result: String(row.result_code ?? 'not_found').toLowerCase(),
    promotedTicketNumber: row.promoted_ticket ?? null,
  };
}

/**
 * Resolve a QR token to its registration, without changing anything.
 *
 * The check-in flow authorises the scanner against this row *before* it redeems
 * the ticket. A plain read is enough to make that safe: a registration's token
 * and event are written once on insert and never change, so the event resolved
 * here is the event the later UPDATE will touch.
 *
 * @param {{qrToken:string}} input
 * @returns {Promise<object|null>} ticket, or null when the token is unknown
 */
export async function findTicketByToken({ qrToken }) {
  const result = await query(
    `${SELECT_TICKET}
      WHERE r.qr_token = @qrToken`,
    { qrToken }
  );
  return toTicket(result.recordset[0]);
}

/**
 * Redeem a QR token at the door.
 *
 * `eventId` must be the event the caller was *authorised* for, not one the
 * client claimed. The procedure re-checks the token against it, so an
 * authorisation decision made a moment earlier cannot drift away from the row
 * that actually gets updated.
 */
export async function checkInTicket({ qrToken, eventId = null }) {
  const result = await query(
    `EXEC dbo.sp_check_in_ticket @QrToken = @qrToken, @EventId = @EventId`,
    { qrToken, eventId }
  );
  const row = result.recordset[0] ?? {};
  return {
    result: String(row.result_code ?? 'invalid').toLowerCase(),
    attendeeName: row.attendee_name ?? null,
    ticketNumber: row.ticket_number ?? null,
    eventId: row.event_id ?? eventId ?? null,
    stillWaitlisted: Number(row.waitlisted ?? 0),
  };
}

/** The signed-in user's own tickets, newest first. */
export async function listMyTickets(userId, { scope = 'upcoming', includeQrToken = false } = {}) {
  const scopeClause =
    {
      upcoming: `AND e.event_date >= CAST(GETDATE() AS DATE) AND r.status IN ('confirmed','waitlisted')`,
      past: `AND (e.event_date < CAST(GETDATE() AS DATE) OR r.status = 'cancelled')`,
      all: '',
    }[scope] ?? '';

  const result = await query(
    `${SELECT_TICKET}
      WHERE r.user_id = @userId ${scopeClause}
      ORDER BY CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END,
               e.event_date ASC, e.start_time ASC`,
    { userId }
  );
  return result.recordset.map((r) => toTicket(r, { includeQrToken }));
}

export async function findTicketForUser({ eventId, userId, includeQrToken = true }) {
  const result = await query(
    `${SELECT_TICKET}
      WHERE r.event_id = @eventId AND r.user_id = @userId AND r.status IN ('confirmed','waitlisted')`,
    { eventId, userId }
  );
  return toTicket(result.recordset[0], { includeQrToken });
}

/**
 * Attendee list for one event. `q` filters by attendee name or email.
 * Returns rows plus a total for pagination.
 */
export async function listEventAttendees({ eventId, status = 'confirmed', search, page = 1, limit = 50 }) {
  const where = ['r.event_id = @eventId'];
  const params = { eventId, offset: (page - 1) * limit, limit };

  if (status && status !== 'all') {
    where.push('r.status = @status');
    params.status = status;
  }
  if (search) {
    where.push('(u.name LIKE @search OR u.email LIKE @search OR r.ticket_number LIKE @search)');
    params.search = `%${search}%`;
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const [rows, count] = await Promise.all([
    query(
      `${SELECT_TICKET} ${clause}
        ORDER BY r.registered_at ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    ),
    query(
      `SELECT COUNT_BIG(*) AS total
         FROM dbo.registrations r
         INNER JOIN dbo.users u ON u.id = r.user_id
        ${clause}`,
      params
    ),
  ]);

  return {
    rows: rows.recordset.map((r) => toTicket(r)),
    total: Number(count.recordset[0].total),
  };
}

/**
 * Head-count roll-up for a single event. Drives the progress bar and the
 * organiser dashboard tiles.
 */
export async function getEventRegistrationStats(eventId) {
  const result = await query(
    `SELECT
       (SELECT COUNT_BIG(*) FROM dbo.registrations r
         WHERE r.event_id = @eventId AND r.status = 'confirmed')  AS confirmed,
       (SELECT COUNT_BIG(*) FROM dbo.registrations r
         WHERE r.event_id = @eventId AND r.status = 'waitlisted') AS waitlisted,
       (SELECT COUNT_BIG(*) FROM dbo.registrations r
         WHERE r.event_id = @eventId AND r.status = 'cancelled')  AS cancelled,
       (SELECT COUNT_BIG(*) FROM dbo.registrations r
         WHERE r.event_id = @eventId AND r.checked_in_at IS NOT NULL) AS checked_in`,
    { eventId }
  );
  const r = result.recordset[0] ?? {};
  return {
    confirmed: Number(r.confirmed ?? 0),
    waitlisted: Number(r.waitlisted ?? 0),
    cancelled: Number(r.cancelled ?? 0),
    checkedIn: Number(r.checked_in ?? 0),
  };
}

export { num };
