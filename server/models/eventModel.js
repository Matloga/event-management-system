import { randomUUID } from 'node:crypto';
import { query } from '../config/database.js';
import { bool, hm, isoDate, num, ymd } from './mappers.js';
import { badRequest, notFound } from '../utils/errors.js';

/**
 * Event queries.
 *
 * Dates and times are CONVERTed to strings in SQL (style 23 / 108) rather than
 * being read as driver Date objects, which keeps them timezone-proof.
 */

const SELECT_EVENT = `
    SELECT
      e.id,
      e.title,
      e.description,
      e.category_id,
      c.name       AS category_name,
      c.slug       AS category_slug,
      c.accent     AS category_accent,
      e.organizer_id,
      o.name       AS organizer_name,
      o.email      AS organizer_email,
      CONVERT(VARCHAR(10), e.event_date, 23) AS event_date,
      CONVERT(VARCHAR(5),  e.start_time, 108) AS start_time,
      CONVERT(VARCHAR(5),  e.end_time,   108) AS end_time,
      e.venue,
      e.address,
      e.city,
      e.country,
      e.latitude,
      e.longitude,
      e.capacity,
      e.price,
      e.is_featured,
      e.is_published,
      e.image_url,
      e.created_at,
      e.updated_at,
      (SELECT COUNT_BIG(*) FROM dbo.registrations r
         WHERE r.event_id = e.id AND r.status = 'confirmed')        AS confirmed_count,
      (SELECT COUNT_BIG(*) FROM dbo.registrations r
         WHERE r.event_id = e.id AND r.status = 'waitlisted')       AS waitlist_count,
      (SELECT COUNT_BIG(*) FROM dbo.registrations r
         WHERE r.event_id = e.id AND r.status = 'confirmed'
           AND r.checked_in_at IS NOT NULL)                        AS checked_in_count,
      (SELECT CAST(ISNULL(AVG(CAST(rv.rating AS FLOAT)), 0) AS DECIMAL(3,2))
         FROM dbo.reviews rv WHERE rv.event_id = e.id)             AS avg_rating,
      (SELECT COUNT_BIG(*) FROM dbo.reviews rv
         WHERE rv.event_id = e.id)                                  AS review_count
    FROM dbo.events e
    INNER JOIN dbo.categories c ON c.id = e.category_id
    INNER JOIN dbo.users o       ON o.id = e.organizer_id
`;

export function mapEvent(row, { viewerId = null, isAdmin = false } = {}) {
  if (!row) return null;

  const capacity = Number(row.capacity);
  const confirmed = Number(row.confirmed_count);
  const seatsLeft = Math.max(0, capacity - confirmed);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: {
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug,
      accent: row.category_accent,
    },
    organizer: {
      id: row.organizer_id,
      name: row.organizer_name,
      email: row.organizer_email,
    },
    date: ymd(row.event_date),
    startTime: hm(row.start_time),
    endTime: hm(row.end_time),
    venue: row.venue,
    address: row.address ?? null,
    city: row.city,
    country: row.country,
    location: row.latitude != null && row.longitude != null
      ? { latitude: num(row.latitude), longitude: num(row.longitude) }
      : null,
    capacity,
    price: num(row.price),
    isFree: num(row.price) === 0,
    seatsLeft,
    isFull: seatsLeft === 0,
    fillRate: capacity > 0 ? Math.round((confirmed / capacity) * 100) : 0,
    waitlistCount: Number(row.waitlist_count),
    checkedInCount: Number(row.checked_in_count),
    isFeatured: bool(row.is_featured),
    isPublished: bool(row.is_published),
    imageUrl: row.image_url ?? null,
    rating: { average: num(row.avg_rating), count: Number(row.review_count) },
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    // Only surfaced to the people allowed to manage the event.
    ...(viewerId && (viewerId === row.organizer_id || isAdmin)
      ? { canManage: true, isOwner: viewerId === row.organizer_id }
      : {}),
  };
}

/** SQL sort keys. Whitelisted so user input can never reach ORDER BY. */
const SORT_OPTIONS = {
  date_asc: 'e.event_date ASC, e.start_time ASC',
  date_desc: 'e.event_date DESC, e.start_time DESC',
  newest: 'e.created_at DESC',
  popular: 'confirmed_count DESC, e.event_date ASC',
  seats: `(e.capacity - (SELECT COUNT_BIG(*) FROM dbo.registrations r
                          WHERE r.event_id = e.id AND r.status = 'confirmed')) ASC`,
  rating: 'avg_rating DESC, review_count DESC',
  price_asc: 'e.price ASC, e.event_date ASC',
  price_desc: 'e.price DESC, e.event_date ASC',
};

const DEFAULT_SORT = 'date_asc';

/**
 * Build the shared WHERE clause used by list, count and export queries.
 *
 * The clause can reference the `c` (category) alias, but the join itself is
 * NOT returned: SELECT_EVENT already contains it, so appending a second
 * `INNER JOIN dbo.categories c` would make SQL Server reject the query for
 * duplicate exposed names. COUNT_CATEGORY_JOIN below is for the count query,
 * which selects from dbo.events on its own.
 *
 * @returns {{clause:string, params:object}}
 */
function buildFilters(f = {}, { viewerId = null, isAdmin = false } = {}) {
  const where = [];
  const params = {};

  const has = (v) => v !== undefined && v !== null && v !== '';

  /* Visibility: published events for everyone; drafts only for their owner/admin. */
  if (!isAdmin) {
    if (viewerId) {
      where.push('(e.is_published = 1 OR e.organizer_id = @viewerId)');
      params.viewerId = viewerId;
    } else {
      where.push('e.is_published = 1');
    }
  }

  if (has(f.scope)) {
    switch (f.scope) {
      case 'upcoming':
        where.push('e.event_date >= CAST(GETDATE() AS DATE)');
        break;
      case 'past':
        where.push('e.event_date < CAST(GETDATE() AS DATE)');
        break;
      case 'published':
        where.push('e.is_published = 1');
        break;
      case 'drafts':
        where.push('e.is_published = 0');
        break;
      case 'mine':
        if (!viewerId) throw badRequest('Sign in to list your own events', 'auth_required');
        where.push('e.organizer_id = @viewerId');
        break;
      case 'featured':
        where.push('e.is_featured = 1');
        break;
      default:
        throw badRequest(`Unknown scope "${f.scope}"`, 'invalid_filter');
    }
  }

  // An independent ownership filter, so "my upcoming events" is expressible
  // without overloading `scope` (which is a single value).
  if (f.mineOnly) {
    if (!viewerId) throw badRequest('Sign in to list your own events', 'auth_required');
    where.push('e.organizer_id = @viewerId');
  }

  if (has(f.search)) {
    // LIKE with a leading wildcard: fine at this scale, and SQL Server will
    // fall back to a scan. Swap for full-text search if the catalogue grows.
    where.push(`(e.title LIKE @search
                 OR e.description LIKE @search
                 OR e.venue LIKE @search
                 OR e.city LIKE @search
                 OR c.name LIKE @search)`);
    params.search = `%${f.search}%`;
  }

  if (has(f.category)) {
    where.push('c.slug = @category');
    params.category = f.category;
  }

  if (has(f.city)) {
    where.push('e.city LIKE @city');
    params.city = `${f.city}%`;
  }

  if (has(f.from)) {
    where.push('e.event_date >= @from');
    params.from = f.from;
  }
  if (has(f.to)) {
    where.push('e.event_date <= @to');
    params.to = f.to;
  }

  if (has(f.pricing)) {
    if (f.pricing === 'free') where.push('e.price = 0');
    else if (f.pricing === 'paid') where.push('e.price > 0');
    else throw badRequest(`Unknown pricing filter "${f.pricing}"`, 'invalid_filter');
  }

  if (has(f.minPrice)) {
    where.push('e.price >= @minPrice');
    params.minPrice = f.minPrice;
  }
  if (has(f.maxPrice)) {
    where.push('e.price <= @maxPrice');
    params.maxPrice = f.maxPrice;
  }

  if (has(f.featured)) where.push(`e.is_featured = ${f.featured ? 1 : 0}`);

  return { clause: where.length ? `WHERE ${where.join('\n      AND ')}` : '', params };
}

/** The count query selects from dbo.events directly, so it needs its own join. */
const COUNT_CATEGORY_JOIN = 'INNER JOIN dbo.categories c ON c.id = e.category_id';

/**
 * Paginated, filtered, sorted event listing.
 * @param {object} filters  see buildFilters
 * @param {{page:number, limit:number, sort:string}} page
 * @param {{viewerId?:string, isAdmin?:boolean}} viewer
 */
export async function listEvents(filters, { page, limit, sort }, viewer = {}) {
  const { clause, params } = buildFilters(filters, viewer);
  const orderBy = SORT_OPTIONS[sort] ?? SORT_OPTIONS[DEFAULT_SORT];
  const paged = { ...params, offset: (page - 1) * limit, limit };

  const [rows, count] = await Promise.all([
    query(`${SELECT_EVENT} ${clause} ORDER BY ${orderBy}
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, paged),
    query(
      `SELECT COUNT_BIG(*) AS total
         FROM dbo.events e
         ${COUNT_CATEGORY_JOIN}
         ${clause}`,
      params
    ),
  ]);

  return {
    rows: rows.recordset.map((r) => mapEvent(r, viewer)),
    total: Number(count.recordset[0].total),
  };
}

/** Cursor-free "page one" helper for dashboard carousels. */
export async function listEventsByIds(ids) {
  if (!ids.length) return [];
  const result = await query(
    `${SELECT_EVENT} WHERE e.id IN (${ids.map((_, i) => `@id${i}`).join(', ')})`,
    Object.fromEntries(ids.map((id, i) => [`id${i}`, id]))
  );
  return result.recordset.map((r) => mapEvent(r));
}

/** Events happening soon - drives the "Upcoming" rail on the home page. */
export async function listUpcoming({ limit = 6, category } = {}) {
  const filters = { scope: 'upcoming', ...(category ? { category } : {}) };
  const { clause, params } = buildFilters(filters, {});
  const result = await query(
    `${SELECT_EVENT} ${clause}
      ORDER BY e.event_date ASC, e.start_time ASC
      OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
    { ...params, limit }
  );
  return result.recordset.map((r) => mapEvent(r));
}

/** Most in demand, ranked by confirmed registrations. */
export async function listPopular({ limit = 6, category } = {}) {
  const filters = { scope: 'upcoming', ...(category ? { category } : {}) };
  const { clause, params } = buildFilters(filters, {});
  const result = await query(
    `${SELECT_EVENT} ${clause}
      ORDER BY confirmed_count DESC, e.event_date ASC
      OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
    { ...params, limit }
  );
  return result.recordset.map((r) => mapEvent(r));
}

export async function listFeatured({ limit = 3 } = {}) {
  const filters = { scope: 'featured' };
  const { clause, params } = buildFilters(filters, {});
  const result = await query(
    `${SELECT_EVENT} ${clause}
      ORDER BY e.event_date ASC
      OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`,
    { ...params, limit }
  );
  return result.recordset.map((r) => mapEvent(r));
}

/**
 * Single event, including drafts. Visibility rules:
 *  - published  -> anyone
 *  - draft      -> its organizer, or an admin
 * @returns {Promise<object|null>}
 */
export async function getEventById(id, viewer = {}) {
  const result = await query(`${SELECT_EVENT} WHERE e.id = @id`, { id });
  const row = result.recordset[0];
  if (!row) return null;

  if (!bool(row.is_published)) {
    const mayView = viewer.isAdmin || (viewer.viewerId && viewer.viewerId === row.organizer_id);
    if (!mayView) return null;
  }
  return mapEvent(row, viewer);
}

/** Ownership check used by the update/delete/publish endpoints. */
export async function findOwnership(id) {
  const result = await query(
    `SELECT id, organizer_id, is_published FROM dbo.events WHERE id = @id`,
    { id }
  );
  return result.recordset[0] ?? null;
}

export async function createEvent(input) {
  const id = randomUUID();
  const result = await query(
    `INSERT INTO dbo.events
        (id, title, description, category_id, organizer_id, event_date, start_time, end_time,
         venue, address, city, country, latitude, longitude, capacity, price,
         is_featured, is_published, image_url)
     OUTPUT INSERTED.id
     VALUES
        (@id, @title, @description, @categoryId, @organizerId, @eventDate, @startTime, @endTime,
         @venue, @address, @city, @country, @latitude, @longitude, @capacity, @price,
         @isFeatured, @isPublished, @imageUrl)`,
    {
      id,
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      organizerId: input.organizerId,
      eventDate: input.eventDate,
      startTime: input.startTime,
      endTime: input.endTime ?? null,
      venue: input.venue,
      address: input.address ?? null,
      city: input.city,
      country: input.country ?? 'South Africa',
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      capacity: input.capacity,
      price: input.price ?? 0,
      isFeatured: input.isFeatured ? 1 : 0,
      isPublished: input.isPublished ? 1 : 0,
      imageUrl: input.imageUrl ?? null,
    }
  );
  return result.recordset[0].id;
}

const EDITABLE_COLUMNS = {
  title: 'title',
  description: 'description',
  categoryId: 'category_id',
  eventDate: 'event_date',
  startTime: 'start_time',
  endTime: 'end_time',
  venue: 'venue',
  address: 'address',
  city: 'city',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  capacity: 'capacity',
  price: 'price',
  isFeatured: 'is_featured',
  isPublished: 'is_published',
  imageUrl: 'image_url',
};

export async function updateEvent(id, patch) {
  const sets = [];
  const params = { id };
  for (const [key, column] of Object.entries(EDITABLE_COLUMNS)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = @${key}`);
    params[key] = patch[key];
  }
  if (!sets.length) return;

  const result = await query(
    `UPDATE dbo.events
        SET ${sets.join(', ')}, updated_at = SYSUTCDATETIME()
      WHERE id = @id`,
    params
  );
  if (result.rowsAffected[0] === 0) throw notFound('Event not found');
}

export async function setPublished(id, isPublished) {
  const result = await query(
    `UPDATE dbo.events SET is_published = @isPublished, updated_at = SYSUTCDATETIME()
      WHERE id = @id`,
    { id, isPublished: isPublished ? 1 : 0 }
  );
  if (result.rowsAffected[0] === 0) throw notFound('Event not found');
}

export async function setFeatured(id, isFeatured) {
  const result = await query(
    `UPDATE dbo.events SET is_featured = @isFeatured, updated_at = SYSUTCDATETIME()
      WHERE id = @id`,
    { id, isFeatured: isFeatured ? 1 : 0 }
  );
  if (result.rowsAffected[0] === 0) throw notFound('Event not found');
}

export async function deleteEvent(id) {
  /* registrations and reviews cascade via FK */
  const result = await query(`DELETE FROM dbo.events WHERE id = @id`, { id });
  if (result.rowsAffected[0] === 0) throw notFound('Event not found');
}

/** Distinct cities that currently have published events - powers the filter dropdown. */
export async function listEventCities() {
  const result = await query(
    `SELECT city, COUNT_BIG(*) AS event_count
       FROM dbo.events
      WHERE is_published = 1
      GROUP BY city
      ORDER BY event_count DESC, city ASC`
  );
  return result.recordset.map((r) => ({ city: r.city, eventCount: Number(r.event_count) }));
}

export { buildFilters, SELECT_EVENT, SORT_OPTIONS };
