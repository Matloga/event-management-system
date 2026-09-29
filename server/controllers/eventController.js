import {
  createEvent,
  deleteEvent,
  findOwnership,
  getEventById,
  listEventCities,
  listEvents,
  listFeatured,
  listPopular,
  listUpcoming,
  setFeatured,
  setPublished,
  updateEvent,
} from '../models/eventModel.js';
import { findCategoryById } from '../models/categoryModel.js';
import { getEventRatingSummary, listEventReviews } from '../models/reviewModel.js';
import { getEventRegistrationStats } from '../models/registrationModel.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { pageMeta, sendData } from '../utils/http.js';

const viewerOf = (req) => ({
  viewerId: req.user?.id ?? null,
  isAdmin: req.user?.role === 'admin',
});

/** Assert the caller owns the event (or is an admin), returning the row. */
async function assertCanManage(eventId, req) {
  const ownership = await findOwnership(eventId);
  if (!ownership) throw notFound('Event not found');

  const isOwner = ownership.organizer_id === req.user.id;
  if (!isOwner && req.user.role !== 'admin') {
    throw forbidden('You can only manage events you created', 'not_event_owner');
  }
  return { ...ownership, isOwner };
}

/** GET /api/events - the browse/search/filter endpoint. */
export const list = asyncHandler(async (req, res) => {
  const { page, limit, sort, ...filters } = req.query;
  const viewer = viewerOf(req);

  const { rows, total } = await listEvents(filters, { page, limit, sort }, viewer);
  return sendData(res, rows, { meta: pageMeta({ page, limit, total }) });
});

/** GET /api/events/home - everything the landing page needs, in one round trip. */
export const home = asyncHandler(async (req, res) => {
  const [featured, upcoming, popular] = await Promise.all([
    listFeatured({ limit: 3 }),
    listUpcoming({ limit: 6 }),
    listPopular({ limit: 6 }),
  ]);

  return sendData(res, {
    featured,
    upcoming,
    popular,
    cities: await listEventCities(),
    counts: {
      upcoming: upcoming.length,
      popular: popular.length,
      featured: featured.length,
    },
  });
});

/** GET /api/events/mine - the caller's own events, drafts included. */
export const mine = asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const scope = req.query.scope ?? 'all';

  // mineOnly pins ownership; scope only narrows by date, so "my upcoming
  // events" stays mine instead of becoming every upcoming event.
  const filters = { mineOnly: true };
  if (scope === 'upcoming' || scope === 'past') filters.scope = scope;

  const { rows, total } = await listEvents(
    filters,
    { page, limit, sort: 'date_desc' },
    { viewerId: req.user.id, isAdmin: false }
  );
  return sendData(res, rows, { meta: pageMeta({ page, limit, total }) });
});

/** GET /api/events/:id */
export const detail = asyncHandler(async (req, res) => {
  const viewer = viewerOf(req);
  const event = await getEventById(req.params.id, viewer);
  if (!event) throw notFound('Event not found');

  const [ratingSummary, reviews, stats] = await Promise.all([
    getEventRatingSummary(req.params.id),
    listEventReviews(req.params.id),
    getEventRegistrationStats(req.params.id),
  ]);

  return sendData(res, {
    event,
    ratingSummary,
    reviews,
    stats,
  });
});

/** POST /api/events */
export const create = asyncHandler(async (req, res) => {
  const body = req.body;

  const category = await findCategoryById(body.categoryId);
  if (!category) throw badRequest('Choose a valid category', 'invalid_category');

  // Capacity can only be as large as the event actually allows.
  if (body.capacity > 100000) throw badRequest('Capacity is unreasonably large', 'invalid_capacity');

  const eventId = await createEvent({
    title: body.title,
    description: body.description,
    categoryId: body.categoryId,
    organizerId: req.user.id,
    eventDate: body.date,
    startTime: body.startTime.length === 5 ? `${body.startTime}:00` : body.startTime,
    endTime: body.endTime
      ? body.endTime.length === 5
        ? `${body.endTime}:00`
        : body.endTime
      : null,
    venue: body.venue,
    address: body.address || null,
    city: body.city,
    country: body.country,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    capacity: body.capacity,
    price: body.price ?? 0,
    isFeatured: body.isFeatured,
    isPublished: body.isPublished,
    imageUrl: body.imageUrl || null,
  });

  const event = await getEventById(eventId, viewerOf(req));
  return sendData(res, { event }, { status: 201 });
});

/** PATCH /api/events/:id */
export const update = asyncHandler(async (req, res) => {
  await assertCanManage(req.params.id, req);

  if (req.body.categoryId) {
    const category = await findCategoryById(req.body.categoryId);
    if (!category) throw badRequest('Choose a valid category', 'invalid_category');
  }

  // Never let an edit strand people who already hold a seat.
  if (req.body.capacity != null) {
    const stats = await getEventRegistrationStats(req.params.id);
    if (req.body.capacity < stats.confirmed) {
      throw conflict(
        `Capacity cannot drop below the ${stats.confirmed} seats already booked`,
        'capacity_below_bookings'
      );
    }
  }

  const patch = {};
  const map = {
    title: 'title',
    description: 'description',
    categoryId: 'categoryId',
    venue: 'venue',
    address: 'address',
    city: 'city',
    country: 'country',
    latitude: 'latitude',
    longitude: 'longitude',
    capacity: 'capacity',
    price: 'price',
    imageUrl: 'imageUrl',
  };
  for (const [from, to] of Object.entries(map)) {
    if (from in req.body) patch[to] = req.body[from] === '' ? null : req.body[from];
  }
  if ('date' in req.body) patch.eventDate = req.body.date;
  if ('startTime' in req.body) {
    patch.startTime = req.body.startTime.length === 5 ? `${req.body.startTime}:00` : req.body.startTime;
  }
  if ('endTime' in req.body) {
    patch.endTime = !req.body.endTime
      ? null
      : req.body.endTime.length === 5
        ? `${req.body.endTime}:00`
        : req.body.endTime;
  }
  if ('isFeatured' in req.body) patch.isFeatured = req.body.isFeatured ? 1 : 0;

  await updateEvent(req.params.id, patch);
  const event = await getEventById(req.params.id, viewerOf(req));
  return sendData(res, { event });
});

/** PATCH /api/events/:id/publish */
export const publish = asyncHandler(async (req, res) => {
  await assertCanManage(req.params.id, req);
  await setPublished(req.params.id, req.body.isPublished);
  const event = await getEventById(req.params.id, viewerOf(req));
  return sendData(res, { event });
});

/** PATCH /api/events/:id/feature - admins only, via requireAdmin. */
export const feature = asyncHandler(async (req, res) => {
  await setFeatured(req.params.id, req.body.isFeatured);
  const event = await getEventById(req.params.id, viewerOf(req));
  return sendData(res, { event });
});

/** DELETE /api/events/:id */
export const remove = asyncHandler(async (req, res) => {
  await assertCanManage(req.params.id, req);
  await deleteEvent(req.params.id);
  return sendData(res, { deleted: true, id: req.params.id });
});

export { assertCanManage, AppError };
