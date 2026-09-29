import { randomUUID } from 'node:crypto';
import { query } from '../config/database.js';
import { conflict, notFound } from '../utils/errors.js';
import { isoDate, num } from './mappers.js';

function toReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    rating: Number(row.rating),
    comment: row.comment ?? null,
    createdAt: isoDate(row.created_at),
    author: row.author_name ? { id: row.user_id, name: row.author_name } : undefined,
  };
}

export async function listEventReviews(eventId, { limit = 20 } = {}) {
  const result = await query(
    `SELECT r.id, r.event_id, r.user_id, r.rating, r.comment, r.created_at, u.name AS author_name
       FROM dbo.reviews r
       INNER JOIN dbo.users u ON u.id = r.user_id
      WHERE r.event_id = @eventId
      ORDER BY r.created_at DESC
      OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
    { eventId, limit }
  );
  return result.recordset.map(toReview);
}

/** Only attendees who actually held a seat may review. */
async function assertAttended(eventId, userId) {
  const result = await query(
    `SELECT 1 FROM dbo.registrations
      WHERE event_id = @eventId AND user_id = @userId AND status = 'confirmed'`,
    { eventId, userId }
  );
  if (result.recordset.length === 0) {
    throw conflict('Only registered attendees can review an event', 'not_an_attendee');
  }
}

export async function createReview({ eventId, userId, rating, comment }) {
  await assertAttended(eventId, userId);
  try {
    const result = await query(
      `INSERT INTO dbo.reviews (id, event_id, user_id, rating, comment)
       OUTPUT INSERTED.id
       VALUES (@id, @eventId, @userId, @rating, @comment)`,
      { id: randomUUID(), eventId, userId, rating, comment: comment ?? null }
    );
    const inserted = result.recordset[0].id;
    const row = await query(
      `SELECT r.id, r.event_id, r.user_id, r.rating, r.comment, r.created_at, u.name AS author_name
         FROM dbo.reviews r INNER JOIN dbo.users u ON u.id = r.user_id
        WHERE r.id = @id`,
      { id: inserted }
    );
    return toReview(row.recordset[0]);
  } catch (err) {
    if (err?.number === 2601 || err?.number === 2627) {
      throw conflict('You have already reviewed this event', 'already_reviewed');
    }
    throw err;
  }
}

export async function deleteReview(id) {
  const result = await query(`DELETE FROM dbo.reviews WHERE id = @id`, { id });
  if (result.rowsAffected[0] === 0) throw notFound('Review not found');
}

/** Aggregate rating + histogram, for the event detail page. */
export async function getEventRatingSummary(eventId) {
  const result = await query(
    `SELECT
       CAST(ISNULL(AVG(CAST(rating AS FLOAT)), 0) AS DECIMAL(3,2)) AS average,
       COUNT_BIG(*) AS total,
       SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS five,
       SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS four,
       SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS three,
       SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS two,
       SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS one
     FROM dbo.reviews
     WHERE event_id = @eventId`,
    { eventId }
  );
  const r = result.recordset[0] ?? {};
  const total = Number(r.total ?? 0);
  return {
    average: num(r.average) ?? 0,
    total,
    distribution: {
      5: Number(r.five ?? 0),
      4: Number(r.four ?? 0),
      3: Number(r.three ?? 0),
      2: Number(r.two ?? 0),
      1: Number(r.one ?? 0),
    },
  };
}
