import jwt from 'jsonwebtoken';
import env from '../config/env.js';

/**
 * Stateless access-token issuing and verification.
 *
 * Access tokens are short-lived bearer tokens. The client stores them in
 * localStorage and sends them as `Authorization: Bearer <token>`. Logging out
 * is therefore client-side; see docs/notes on adding refresh tokens.
 */

const ISSUER = 'event-management-system';
const AUDIENCE = 'event-management-client';

/**
 * @param {{ id: string, email: string, role: string }} user
 * @returns {string} signed JWT
 */
export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, issuer: ISSUER, audience: AUDIENCE }
  );
}

/**
 * @param {string} token
 * @returns {{ sub: string, email: string, role: string }} payload
 * @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError}
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { issuer: ISSUER, audience: AUDIENCE });
}

/** Seconds until the supplied token expires (used to set Cache-Control). */
export function expiresInSeconds(token) {
  const { exp } = jwt.decode(token) ?? {};
  return exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 0;
}

/** Extract a bearer token from the Authorization header. */
export function bearerFromHeader(header) {
  if (typeof header !== 'string') return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!/^bearer$/i.test(scheme)) return null;
  const token = rest.join(' ').trim();
  return token || null;
}
