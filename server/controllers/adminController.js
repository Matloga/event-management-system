import { listUsers, getUserStats } from '../models/userModel.js';
import { listEvents } from '../models/eventModel.js';
import { query } from '../config/database.js';
import {
  getActivityTrend,
  getCategoryBreakdown,
  getOrganizerStats,
  getPlatformStats,
  getTopCities,
  getTopEvents,
} from '../services/statsService.js';
import { registrationsToCsv, csvFilename } from '../services/csvService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { pageMeta, sendData } from '../utils/http.js';

/** GET /api/admin/stats - platform-wide analytics (admin only). */
export const stats = asyncHandler(async (req, res) => {
  const [platform, trend, categories, topEvents, cities, users] = await Promise.all([
    getPlatformStats(),
    getActivityTrend(Number(req.query.days ?? 30)),
    getCategoryBreakdown(),
    getTopEvents(Number(req.query.limit ?? 5)),
    getTopCities(),
    getUserStats(),
  ]);

  return sendData(res, { platform, trend, categories, topEvents, cities, users });
});

/** GET /api/admin/users - user administration (admin only). */
export const users = asyncHandler(async (req, res) => {
  const { search, role, page, limit } = req.query;
  const { rows, total } = await listUsers({ search, role, page, limit });
  return sendData(res, rows, { meta: pageMeta({ page, limit, total }) });
});

/** GET /api/admin/events - every event, drafts included (admin only). */
export const events = asyncHandler(async (req, res) => {
  const { page, limit, sort, ...filters } = req.query;
  const { rows, total } = await listEvents(
    filters,
    { page, limit, sort: sort ?? 'newest' },
    { viewerId: req.user.id, isAdmin: true }
  );
  return sendData(res, rows, { meta: pageMeta({ page, limit, total }) });
});

/** GET /api/admin/registrations.csv - every registration on the platform. */
export const registrationsCsv = asyncHandler(async (_req, res) => {
  const result = await query(`
    SELECT
      r.ticket_number, r.status, u.name AS attendee_name, u.email AS attendee_email,
      e.title AS event_title,
      CONVERT(VARCHAR(10), e.event_date, 23) AS event_date,
      e.city, r.registered_at, r.checked_in_at
    FROM dbo.registrations r
    INNER JOIN dbo.users u  ON u.id = r.user_id
    INNER JOIN dbo.events e ON e.id = r.event_id
    ORDER BY r.registered_at DESC
  `);

  const tickets = result.recordset.map((r) => ({
    ticketNumber: r.ticket_number,
    status: String(r.status).toLowerCase(),
    attendee: { name: r.attendee_name, email: r.attendee_email },
    event: { title: r.event_title, date: String(r.event_date).slice(0, 10), city: r.city },
    registeredAt: r.registered_at,
    isCheckedIn: Boolean(r.checked_in_at),
  }));

  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="all-registrations.csv"');
  return res.send(registrationsToCsv(tickets));
});

/** GET /api/dashboard - role-aware summary for the signed-in user. */
export const myDashboard = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';

  const [organizer, upcoming] = await Promise.all([
    getOrganizerStats(req.user.id),
    listEvents(
      { scope: 'upcoming' },
      { page: 1, limit: 5, sort: 'popular' },
      { viewerId: req.user.id, isAdmin: false }
    ),
  ]);

  if (!isAdmin && req.user.role !== 'organizer') {
    const mine = await query(
      `SELECT
         (SELECT COUNT_BIG(*) FROM dbo.registrations r
           JOIN dbo.events e ON e.id = r.event_id
          WHERE r.user_id = @userId AND r.status = 'confirmed'
            AND e.event_date >= CAST(GETDATE() AS DATE))                    AS upcoming_tickets,
         (SELECT COUNT_BIG(*) FROM dbo.registrations r
           JOIN dbo.events e ON e.id = r.event_id
          WHERE r.user_id = @userId AND r.status = 'waitlisted')             AS waitlisted,
         (SELECT COUNT_BIG(*) FROM dbo.registrations r
           JOIN dbo.events e ON e.id = r.event_id
          WHERE r.user_id = @userId AND r.status = 'cancelled')              AS cancelled`,
      { userId: req.user.id }
    );
    const m = mine.recordset[0] ?? {};
    return sendData(res, {
      role: 'attendee',
      tickets: {
        upcoming: Number(m.upcoming_tickets ?? 0),
        waitlisted: Number(m.waitlisted ?? 0),
        cancelled: Number(m.cancelled ?? 0),
      },
      recommended: upcoming.rows,
    });
  }

  return sendData(res, {
    role: req.user.role,
    organizer,
    platform: isAdmin ? await getPlatformStats() : null,
    topEvents: await getTopEvents(5),
    suggested: upcoming.rows,
  });
});
