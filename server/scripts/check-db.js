/**
 * Reports whether the configured database is reachable and whether the
 * schema has been applied. Handy as a first thing to run.
 *
 *   npm run db:verify
 */
import sql from 'mssql';
import env from '../config/env.js';

const REQUIRED = [
  'users',
  'categories',
  'events',
  'registrations',
  'reviews',
  'sp_register_for_event',
  'sp_cancel_registration',
  'sp_check_in_ticket',
];

let pool;
try {
  pool = await sql.connect({
    server: env.DB_SERVER,
    port: env.DB_PORT,
    database: env.dbName,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: {
      encrypt: env.DB_ENCRYPT,
      trustServerCertificate: env.DB_TRUST_CERT,
      enableArithAbort: true,
      connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
    },
  });
  console.log(`[ok] connected to ${env.DB_SERVER} / ${env.dbName}`);
} catch (err) {
  console.error(`[fail] cannot reach ${env.DB_SERVER}:${env.DB_PORT} - ${err.message}`);
  process.exit(1);
}

const result = await pool.request().query(`
  SELECT
    OBJECT_ID(N'dbo.users', 'U')                    AS users,
    OBJECT_ID(N'dbo.categories', 'U')               AS categories,
    OBJECT_ID(N'dbo.events', 'U')                   AS events,
    OBJECT_ID(N'dbo.registrations', 'U')            AS registrations,
    OBJECT_ID(N'dbo.reviews', 'U')                  AS reviews,
    OBJECT_ID(N'dbo.sp_register_for_event', 'P')    AS sp_register_for_event,
    OBJECT_ID(N'dbo.sp_cancel_registration', 'P')   AS sp_cancel_registration,
    OBJECT_ID(N'dbo.sp_check_in_ticket', 'P')       AS sp_check_in_ticket
`);

const row = result.recordset[0];
const missing = REQUIRED.filter((name) => row[name] == null);

if (missing.length === 0) {
  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT_BIG(*) FROM dbo.users)         AS users,
      (SELECT COUNT_BIG(*) FROM dbo.categories)    AS categories,
      (SELECT COUNT_BIG(*) FROM dbo.events)        AS events,
      (SELECT COUNT_BIG(*) FROM dbo.registrations) AS registrations
  `);
  const c = counts.recordset[0];
  console.log('[ok] schema is complete');
  console.log(
    `     users=${c.users} categories=${c.categories} events=${c.events} registrations=${c.registrations}`
  );
  console.log('     (empty tables? run `npm run seed`)');
} else {
  console.error(`[fail] missing objects: ${missing.join(', ')}`);
  console.error('       run `npm run db:reset` to apply the schema and procedures');
  process.exitCode = 1;
}

await pool.close();
