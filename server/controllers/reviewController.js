import { createReview, deleteReview, getEventRatingSummary, listEventReviews } from '../models/reviewModel.js';
import { getEventById } from '../models/eventModel.js';
import { query } from '../config/database.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound } from '../utils/errors.js';
import { sendData } from '../utils/http.js';

/** GET /api/events/:eventId/reviews */
export const eventReviews = asyncHandler(async (req, res) => {
  const [reviews, summary] = await Promise.all([
    listEventReviews(req.params.eventId),
    getEventRatingSummary(req.params.eventId),
  ]);
  return sendData(res, { reviews, summary });
});

/** POST /api/events/:eventId/reviews - only confirmed attendees may review. */
export const addReview = asyncHandler(async (req, res) => {
  const event = await getEventById(req.params.eventId, {
    viewerId: req.user.id,
    isAdmin: req.user.role === 'admin',
  });
  if (!event) throw notFound('Event not found');

  const review = await createReview({
    eventId: req.params.eventId,
    userId: req.user.id,
    rating: req.body.rating,
    comment: req.body.comment,
  });

  return sendData(
    res,
    { review, summary: await getEventRatingSummary(req.params.eventId) },
    { status: 201 }
  );
});

/** DELETE /api/reviews/:id - the author, or an admin. */
export const removeReview = asyncHandler(async (req, res) => {
  const result = await query(`SELECT user_id FROM dbo.reviews WHERE id = @id`, { id: req.params.id });
  const row = result.recordset[0];
  if (!row) throw notFound('Review not found');

  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    throw forbidden('You can only delete your own review', 'not_review_author');
  }

  await deleteReview(req.params.id);
  return sendData(res, { deleted: true, id: req.params.id });
});
