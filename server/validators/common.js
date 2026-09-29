import { z } from 'zod';

/** Shared building blocks for request validation. */

export const uuid = z.uuid('Must be a valid id');

/** Password rules enforced on both register and password change. */
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be 128 characters or fewer')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .email('Enter a valid email address');

/** 'YYYY-MM-DD' */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real calendar date');

/** 'HH:MM' or 'HH:MM:SS' */
export const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a 24-hour time such as 18:30');

/** Accepts "true"/"false"/"1"/"0" from query strings. */
export const boolish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

/**
 * Pagination. `limit` is capped so a client cannot ask for the whole table.
 */
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
});

/** Strip unknown keys and normalise the remaining ones. */
export const clean = (schema) => ({
  parse: (input) => schema.parse(input ?? {}),
  safeParse: (input) => schema.safeParse(input ?? {}),
});
