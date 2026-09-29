import bcrypt from 'bcryptjs';
import env from '../config/env.js';
import { query } from '../config/database.js';
import {
  createUser,
  findUserById,
  findUserCredentialsByEmail,
  updateUserPassword,
  updateUserProfile,
  updateUserRole,
} from '../models/userModel.js';
import { signAccessToken } from '../services/tokenService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { conflict, notFound, unauthorized } from '../utils/errors.js';
import { sendData } from '../utils/http.js';

/**
 * First registered account becomes the platform admin so a fresh install is
 * immediately manageable, and every later account starts as an attendee.
 * Promote others with the admin user-management endpoint.
 */
async function isFirstUser() {
  const result = await query(`SELECT COUNT_BIG(*) AS total FROM dbo.users`);
  return Number(result.recordset[0].total) === 0;
}

/** POST /api/auth/register */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, organisation } = req.body;

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const role = (await isFirstUser()) ? 'admin' : 'attendee';

  const user = await createUser({ name, email, passwordHash, role, organisation });
  const token = signAccessToken(user);

  return sendData(res, { user, token }, { status: 201 });
});

/** POST /api/auth/login */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const record = await findUserCredentialsByEmail(email);

  /* Compare a dummy hash when the account is missing so the response time
     does not reveal whether an email is registered. */
  const hash = record?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);

  if (!record || !ok) {
    throw unauthorized('Email or password is incorrect', 'invalid_credentials');
  }

  const token = signAccessToken(record.user);
  return sendData(res, { user: record.user, token });
});

/** POST /api/auth/logout - stateless, so this only confirms intent. */
export const logout = asyncHandler(async (_req, res) => sendData(res, { loggedOut: true }));

/** GET /api/auth/me */
export const me = asyncHandler(async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) throw notFound('Account not found');
  return sendData(res, { user });
});

/** PATCH /api/auth/profile */
export const updateProfile = asyncHandler(async (req, res) => {
  const user = await updateUserProfile(req.user.id, req.body);
  return sendData(res, { user });
});

/** POST /api/auth/password */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const record = await findUserCredentialsByEmail(req.user.email);

  if (!record || !(await bcrypt.compare(currentPassword, record.passwordHash))) {
    throw unauthorized('Current password is incorrect', 'invalid_credentials');
  }

  await updateUserPassword(req.user.id, await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS));
  return sendData(res, { updated: true });
});

/** PATCH /api/users/:id/role - admin only. */
export const setUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (req.params.id === req.user.id && role !== 'admin') {
    throw conflict('You cannot remove your own admin access', 'self_demotion');
  }

  const user = await updateUserRole(req.params.id, role);
  return sendData(res, { user });
});
