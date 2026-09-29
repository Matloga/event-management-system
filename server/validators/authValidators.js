import { z } from 'zod';
import { email, password, uuid } from './common.js';

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
    email,
    password,
    organisation: z.string().trim().max(120).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    // Deliberately NOT the strict `password` rule: an account created before a
    // password-policy change must still be able to sign in.
    password: z.string().min(1, 'Password is required').max(128),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    organisation: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: password,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must differ from the current one',
    path: ['newPassword'],
  });

export const updateRoleSchema = z.object({ role: z.enum(['attendee', 'organizer', 'admin']) }).strict();

export const listUsersSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    role: z.enum(['attendee', 'organizer', 'admin']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const userIdParam = z.object({ id: uuid });
