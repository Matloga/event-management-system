import { randomUUID } from 'node:crypto';
import { query } from '../config/database.js';
import { bool, isoDate } from './mappers.js';
import { conflict, notFound } from '../utils/errors.js';

/** Columns safe to expose for the currently authenticated user. */
const PUBLIC_COLUMNS = `
    u.id, u.name, u.email, u.role, u.organisation, u.phone, u.bio,
    u.created_at, u.updated_at
`;

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: String(row.role).toLowerCase(),
    organisation: row.organisation ?? null,
    phone: row.phone ?? null,
    bio: row.bio ?? null,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

export { toUser };

/** @returns {Promise<object|null>} */
export async function findUserByEmail(email) {
  const result = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM dbo.users u WHERE u.email = @email`,
    { email }
  );
  return toUser(result.recordset[0]);
}

/** Includes password_hash - only for the login path. */
export async function findUserCredentialsByEmail(email) {
  const result = await query(
    `SELECT ${PUBLIC_COLUMNS}, u.password_hash
       FROM dbo.users u
      WHERE u.email = @email`,
    { email }
  );
  const row = result.recordset[0];
  if (!row) return null;
  return { user: toUser(row), passwordHash: row.password_hash };
}

export async function findUserById(id) {
  const result = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM dbo.users u WHERE u.id = @id`,
    { id }
  );
  return toUser(result.recordset[0]);
}

/**
 * Insert a new account.
 * @param {{name:string,email:string,passwordHash:string,role?:string,organisation?:string|null,phone?:string|null}} input
 */
export async function createUser(input) {
  try {
    const result = await query(
      `INSERT INTO dbo.users (id, name, email, password_hash, role, organisation, phone)
       OUTPUT INSERTED.id
       VALUES (@id, @name, @email, @passwordHash, @role, @organisation, @phone)`,
      {
        id: randomUUID(),
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role ?? 'attendee',
        organisation: input.organisation ?? null,
        phone: input.phone ?? null,
      }
    );
    return findUserById(result.recordset[0].id);
  } catch (err) {
    if (err?.number === 2601 || err?.number === 2627) {
      throw conflict('An account with that email address already exists', 'email_taken');
    }
    throw err;
  }
}

/**
 * @param {string} id
 * @param {{name?:string,organisation?:string|null,phone?:string|null,bio?:string|null}} patch
 */
export async function updateUserProfile(id, patch) {
  const columns = {
    name: 'name',
    organisation: 'organisation',
    phone: 'phone',
    bio: 'bio',
  };

  const sets = [];
  const params = { id };
  for (const [key, column] of Object.entries(columns)) {
    if (key in patch) {
      sets.push(`${column} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (sets.length === 0) return findUserById(id);

  const result = await query(
    `UPDATE dbo.users
        SET ${sets.join(', ')}, updated_at = SYSUTCDATETIME()
      WHERE id = @id`,
    params
  );
  if (result.rowsAffected[0] === 0) throw notFound('Account not found');
  return findUserById(id);
}

/** @param {string} id */
export async function updateUserPassword(id, passwordHash) {
  const result = await query(
    `UPDATE dbo.users
        SET password_hash = @passwordHash, updated_at = SYSUTCDATETIME()
      WHERE id = @id`,
    { id, passwordHash }
  );
  if (result.rowsAffected[0] === 0) throw notFound('Account not found');
}

/** Email address is the primary key for sign-in, so a role flip is the only admin edit. */
export async function updateUserRole(id, role) {
  const result = await query(
    `UPDATE dbo.users SET role = @role, updated_at = SYSUTCDATETIME() WHERE id = @id`,
    { id, role }
  );
  if (result.rowsAffected[0] === 0) throw notFound('Account not found');
  return findUserById(id);
}

/** Platform-wide counters for the admin dashboard. */
export async function getUserStats() {
  const result = await query(`
    SELECT
      COUNT_BIG(*) AS total,
      SUM(CASE WHEN role = 'admin'      THEN 1 ELSE 0 END) AS admins,
      SUM(CASE WHEN role = 'organizer'  THEN 1 ELSE 0 END) AS organizers,
      SUM(CASE WHEN role = 'attendee'   THEN 1 ELSE 0 END) AS attendees
    FROM dbo.users
  `);
  const r = result.recordset[0] ?? {};
  return {
    total: Number(r.total ?? 0),
    admins: Number(r.admins ?? 0),
    organizers: Number(r.organizers ?? 0),
    attendees: Number(r.attendees ?? 0),
  };
}

/** Admin user management list, paginated and searchable. */
export async function listUsers({ search, role, page, limit }) {
  const where = [];
  const params = { offset: (page - 1) * limit, limit };

  if (search) {
    where.push('(u.name LIKE @search OR u.email LIKE @search)');
    params.search = `%${search}%`;
  }
  if (role) {
    where.push('u.role = @role');
    params.role = role;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, count] = await Promise.all([
    query(
      `SELECT ${PUBLIC_COLUMNS}
         FROM dbo.users u
         ${clause}
        ORDER BY u.created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    ),
    query(`SELECT COUNT_BIG(*) AS total FROM dbo.users u ${clause}`, params),
  ]);

  return { rows: rows.recordset.map(toUser), total: Number(count.recordset[0].total) };
}

export { bool };
