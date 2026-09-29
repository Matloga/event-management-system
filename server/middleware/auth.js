import { forbidden, unauthorized } from '../utils/errors.js';
import { bearerFromHeader, verifyAccessToken } from '../services/tokenService.js';
import { findUserById } from '../models/userModel.js';

/**
 * Resolve the bearer token on the request to a live user record.
 *
 * The database is consulted on every authenticated request so that a deleted
 * or demoted account cannot keep using a token that is still cryptographically
 * valid. Returns null when no valid token is present.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{id:string,email:string,name:string,role:string}|null>}
 */
async function resolveUser(req) {
  const token = bearerFromHeader(req.headers.authorization);
  if (!token) return null;

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return null;
  }

  const user = await findUserById(payload.sub);
  return user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null;
}

/** Rejects the request with 401 unless a valid bearer token is present. */
export async function requireAuth(req, _res, next) {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return next(unauthorized('Sign in to continue', 'no_session'));
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Populates `req.user` when a valid token is present but never rejects.
 * Used by public endpoints that personalise their response.
 */
export async function optionalAuth(req, _res, next) {
  try {
    req.user = await resolveUser(req);
  } catch {
    req.user = null;
  }
  return next();
}

/**
 * Restrict a route to specific roles. Must run after requireAuth.
 * @param  {...('attendee'|'organizer'|'admin')} roles
 */
export function requireRole(...roles) {
  const allowed = new Set(roles);
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized('Sign in to continue', 'no_session'));
    if (!allowed.has(req.user.role)) {
      return next(forbidden('Your account does not have access to this action', 'insufficient_role'));
    }
    return next();
  };
}

/** Convenience: route is open to anyone, but organisers get extra fields. */
export const requireOrganizer = requireRole('organizer', 'admin');
export const requireAdmin = requireRole('admin');
