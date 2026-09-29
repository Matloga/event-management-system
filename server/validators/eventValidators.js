import { z } from 'zod';
import { clockTime, isoDate, uuid } from './common.js';

const categoryId = uuid;

/**
 * Shape shared by create and update. Deliberately free of defaults: applying
 * a default on update would silently overwrite a stored value whenever a
 * field was omitted from the request body.
 */
const baseEventFields = {
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z
    .string()
    .trim()
    .min(20, 'Give attendees at least 20 characters of detail')
    .max(8000),
  categoryId,
  date: isoDate,
  startTime: clockTime,
  endTime: clockTime.optional(),
  venue: z.string().trim().min(2, 'Venue is required').max(200),
  address: z.string().trim().max(255).optional(),
  city: z.string().trim().min(2, 'City is required').max(100),
  country: z.string().trim().max(100),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1').max(100000),
  price: z.coerce.number().min(0).max(1_000_000),
  imageUrl: z.url('Enter a valid image URL').max(500).optional().or(z.literal('')),
};

const futureDate = () => new Date().toISOString().slice(0, 10);

/** Add cross-field issues for a complete event. */
function checkTemporal(value, ctx) {
  if (value.date && value.date < futureDate()) {
    ctx.addIssue({ code: 'custom', message: 'Event date cannot be in the past', path: ['date'] });
  }
  if (value.startTime && value.endTime && value.endTime <= value.startTime) {
    ctx.addIssue({
      code: 'custom',
      message: 'End time must be after the start time',
      path: ['endTime'],
    });
  }
}

export const createEventSchema = z
  .object({
    ...baseEventFields,
    // Defaults belong on create only.
    country: baseEventFields.country.default('South Africa'),
    price: baseEventFields.price.default(0),
    isPublished: z.boolean().default(false),
    isFeatured: z.boolean().default(false),
  })
  .strict()
  .superRefine(checkTemporal);

export const updateEventSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(baseEventFields).map(([key, schema]) => [key, schema.optional()])
    ),
    imageUrl: z.url().max(500).optional().or(z.literal('')).nullable(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    address: z.string().trim().max(255).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A field that was explicitly present but null still counts as "sent";
    // a body where every optional field came back undefined does not.
    const provided = Object.values(value).filter((v) => v !== undefined);
    if (provided.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Nothing to update', path: ['_'] });
      return;
    }
    checkTemporal(value, ctx);
    if (value.latitude != null && value.longitude == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide a longitude when setting a latitude (needed for the map)',
        path: ['longitude'],
      });
    }
  });

export const listEventsSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    category: z.string().trim().max(60).optional(),
    city: z.string().trim().max(100).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    scope: z
      .enum(['upcoming', 'past', 'published', 'drafts', 'mine', 'featured'])
      .optional(),
    pricing: z.enum(['free', 'paid']).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    featured: z.enum(['true', 'false', '1', '0']).optional(),
    sort: z
      .enum([
        'date_asc',
        'date_desc',
        'newest',
        'popular',
        'seats',
        'rating',
        'price_asc',
        'price_desc',
      ])
      .default('date_asc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(12),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({ code: 'custom', message: '"from" must be before "to"', path: ['from'] });
    }
    if (value.minPrice != null && value.maxPrice != null && value.minPrice > value.maxPrice) {
      ctx.addIssue({ code: 'custom', message: 'minPrice cannot exceed maxPrice', path: ['minPrice'] });
    }
  });

export const eventIdParam = z.object({ id: uuid });

export const publishSchema = z
  .object({ isPublished: z.boolean().default(true) })
  .strict();

export const featureSchema = z
  .object({ isFeatured: z.boolean().default(true) })
  .strict();

export const reviewSchema = z
  .object({
    rating: z.coerce.number().int().min(1, 'Pick a rating from 1 to 5').max(5),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

export const attendeesSchema = z
  .object({
    status: z.enum(['confirmed', 'waitlisted', 'cancelled', 'all']).default('confirmed'),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
