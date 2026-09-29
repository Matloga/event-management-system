import { query } from '../config/database.js';

/**
 * Aggregates for the organiser and admin dashboards.
 * Every figure is a single aggregate query so the dashboard stays cheap.
 */

export async function getPlatformStats() {
  const result = await query(`
    SELECT
      (SELECT COUNT_BIG(*) FROM dbo.events)                                        AS events_total,
      (SELECT COUNT_BIG(*) FROM dbo.events WHERE is_published = 1)                 AS events_published,
      (SELECT COUNT_BIG(*) FROM dbo.events
         WHERE is_published = 1 AND event_date >= CAST(GETDATE() AS DATE))       AS events_upcoming,
      (SELECT COUNT_BIG(*) FROM dbo.registrations WHERE status = 'confirmed')      AS registrations_confirmed,
      (SELECT COUNT_BIG(*) FROM dbo.registrations WHERE status = 'waitlisted')     AS registrations_waitlisted,
      (SELECT COUNT_BIG(*) FROM dbo.registrations WHERE status = 'cancelled')      AS registrations_cancelled,
      (SELECT COUNT_BIG(*) FROM dbo.registrations
         WHERE status = 'confirmed' AND checked_in_at IS NOT NULL)                AS checkins,
      (SELECT CAST(ISNULL(SUM(CAST(e.price AS DECIMAL(18,2))), 0) AS DECIMAL(18,2))
         FROM dbo.events e
         JOIN dbo.registrations r ON r.event_id = e.id AND r.status = 'confirmed') AS ticket_revenue,
      (SELECT CAST(ISNULL(AVG(CAST(rating AS FLOAT)), 0) AS DECIMAL(3,2)) FROM dbo.reviews) AS avg_rating
  `);
  const r = result.recordset[0] ?? {};
  const num = (v) => Number(v ?? 0);
  return {
    events: {
      total: num(r.events_total),
      published: num(r.events_published),
      upcoming: num(r.events_upcoming),
      drafts: num(r.events_total) - num(r.events_published),
    },
    registrations: {
      confirmed: num(r.registrations_confirmed),
      waitlisted: num(r.registrations_waitlisted),
      cancelled: num(r.registrations_cancelled),
      checkins: num(r.checkins),
    },
    ticketRevenue: num(r.ticket_revenue),
    averageRating: num(r.avg_rating),
  };
}

/** Sign-ups and registrations per day for the last N days, gaps filled in. */
export async function getActivityTrend(days = 30) {
  const result = await query(`
    SELECT day, SUM(signups) AS signups, SUM(registrations) AS registrations
    FROM (
      SELECT CAST(u.created_at AS DATE) AS day, COUNT_BIG(*) AS signups, CAST(0 AS BIGINT) AS registrations
        FROM dbo.users u
       WHERE u.created_at >= DATEADD(DAY, -@days, SYSUTCDATETIME())
       GROUP BY CAST(u.created_at AS DATE)
      UNION ALL
      SELECT CAST(r.registered_at AS DATE) AS day, CAST(0 AS BIGINT), COUNT_BIG(*)
        FROM dbo.registrations r
       WHERE r.registered_at >= DATEADD(DAY, -@days, SYSUTCDATETIME())
       GROUP BY CAST(r.registered_at AS DATE)
    ) t
    GROUP BY day
    ORDER BY day ASC
  `, { days });

  const totals = new Map(
    result.recordset.map((r) => [
      String(r.day).slice(0, 10),
      { signups: Number(r.signups), registrations: Number(r.registrations) },
    ])
  );

  // SQL only returns days that have data; build the full series so the chart
  // has a point for every day in the window.
  const series = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const hit = totals.get(key);
    series.push({ date: key, signups: hit?.signups ?? 0, registrations: hit?.registrations ?? 0 });
  }
  return series;
}

/** Head-count per category, for the admin breakdown. */
export async function getCategoryBreakdown() {
  const result = await query(`
    SELECT
      c.name,
      c.slug,
      c.accent,
      COUNT(DISTINCT e.id) AS events,
      COALESCE(SUM(reg.confirmed), 0) AS registrations
    FROM dbo.categories c
    LEFT JOIN dbo.events e ON e.category_id = c.id AND e.is_published = 1
    LEFT JOIN (
      SELECT event_id, COUNT_BIG(*) AS confirmed
        FROM dbo.registrations WHERE status = 'confirmed' GROUP BY event_id
    ) reg ON reg.event_id = e.id
    GROUP BY c.name, c.slug, c.accent
    ORDER BY registrations DESC, c.name ASC
  `);
  return result.recordset.map((r) => ({
    category: r.name,
    slug: r.slug,
    accent: r.accent,
    events: Number(r.events),
    registrations: Number(r.registrations),
  }));
}

/** Top events by confirmed registrations. */
export async function getTopEvents(limit = 5) {
  const result = await query(`
    SELECT TOP (@limit)
      e.id, e.title, e.capacity, e.is_published,
      COUNT_BIG(CASE WHEN r.status = 'confirmed' THEN 1 END) AS confirmed,
      COUNT_BIG(CASE WHEN r.status = 'waitlisted' THEN 1 END) AS waitlisted
    FROM dbo.events e
    LEFT JOIN dbo.registrations r ON r.event_id = e.id
    GROUP BY e.id, e.title, e.capacity, e.is_published
    ORDER BY confirmed DESC, e.title ASC
  `, { limit });
  return result.recordset.map((r) => {
    const capacity = Number(r.capacity);
    const confirmed = Number(r.confirmed);
    return {
      id: r.id,
      title: r.title,
      capacity,
      isPublished: Boolean(r.is_published),
      confirmed,
      waitlisted: Number(r.waitlisted),
      fillRate: capacity > 0 ? Math.round((confirmed / capacity) * 100) : 0,
    };
  });
}

/**
 * Organiser roll-up SQL.
 *
 * Aggregated per event in a CTE, then summed. Joining registrations onto
 * events in a single pass would emit one row per registration, which multiplies
 * each event's `capacity` by its registration count and inflates every total -
 * an event with 4 seats and 3 bookings would report 12 seats offered and a fill
 * rate of 25% instead of 75%. Correlated subqueries keep the CTE at exactly one
 * row per event, so SUM() is safe.
 */
export const ORGANIZER_STATS_SQL = `WITH per_event AS (
       SELECT
         e.id,
         e.is_published,
         e.capacity,
         e.event_date,
         (SELECT COUNT_BIG(*) FROM dbo.registrations r
           WHERE r.event_id = e.id AND r.status = 'confirmed')                    AS confirmed,
         (SELECT COUNT_BIG(*) FROM dbo.registrations r
           WHERE r.event_id = e.id AND r.status = 'waitlisted')                   AS waitlisted,
         (SELECT COUNT_BIG(*) FROM dbo.registrations r
           WHERE r.event_id = e.id AND r.status = 'confirmed'
             AND r.checked_in_at IS NOT NULL)                                     AS checkins
       FROM dbo.events e
       WHERE e.organizer_id = @organizerId
     )
     SELECT
       COUNT_BIG(*)                                                          AS events_total,
       COALESCE(SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END), 0)        AS published,
       COALESCE(SUM(CASE WHEN is_published = 1
                          AND event_date >= CAST(GETDATE() AS DATE)
                         THEN 1 ELSE 0 END), 0)                              AS upcoming,
       COALESCE(SUM(confirmed), 0)                                            AS registrations,
       COALESCE(SUM(waitlisted), 0)                                           AS waitlisted,
       COALESCE(SUM(capacity), 0)                                             AS total_capacity,
       COALESCE(SUM(checkins), 0)                                             AS checkins
     FROM per_event`;

/**
 * Map the roll-up row into the shape the dashboard renders.
 *
 * COUNT_BIG and SUM return strings through the mssql driver, and an organizer
 * with no events gets a row of NULLs, so every figure is coerced to a number
 * and divided by zero is handled here rather than producing NaN.
 */
export function toOrganizerStats(row = {}) {
  const capacity = Number(row.total_capacity ?? 0);
  const registrations = Number(row.registrations ?? 0);
  return {
    events: {
      total: Number(row.events_total ?? 0),
      published: Number(row.published ?? 0),
      upcoming: Number(row.upcoming ?? 0),
    },
    registrations,
    waitlisted: Number(row.waitlisted ?? 0),
    checkins: Number(row.checkins ?? 0),
    totalCapacity: capacity,
    averageFillRate: capacity > 0 ? Math.round((registrations / capacity) * 100) : 0,
  };
}

/** Organiser-specific roll-up: only events they own. */
export async function getOrganizerStats(organizerId) {
  const result = await query(ORGANIZER_STATS_SQL, { organizerId });
  return toOrganizerStats(result.recordset[0]);
}

/** Cities with the most upcoming events - the "where is happening" widget. */
export async function getTopCities(limit = 6) {
  const result = await query(`
    SELECT TOP (@limit) city, country, COUNT_BIG(*) AS events
    FROM dbo.events
    WHERE is_published = 1 AND event_date >= CAST(GETDATE() AS DATE)
    GROUP BY city, country
    ORDER BY events DESC, city ASC
  `, { limit });
  return result.recordset.map((r) => ({
    city: r.city,
    country: r.country,
    events: Number(r.events),
  }));
}
