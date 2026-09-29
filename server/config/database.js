import sql from 'mssql';
import env from './env.js';

/**
 * SQL Server connection pool.
 *
 * The pool is created eagerly but connections are opened lazily, so
 * importing this module is safe in unit tests that never touch the DB.
 */

const poolConfig = {
  server: env.DB_SERVER,
  port: env.DB_PORT,
  database: env.dbName,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  options: {
    encrypt: env.DB_ENCRYPT,
    trustServerCertificate: env.DB_TRUST_CERT,
    enableArithAbort: true,
    // Fail fast instead of hanging forever when the DB is unreachable.
    connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
    requestTimeout: 30000,
  },
  pool: {
    max: env.DB_POOL_MAX,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

export const pool = new sql.ConnectionPool(poolConfig);

let connectPromise = null;

/** Idempotently open the pool. Safe to call from anywhere, any number of times. */
export function connect() {
  if (!connectPromise) {
    pool.on('error', (err) => {
      // A pooled connection died underneath us; the pool recovers, but log it.
      console.error('[db] idle pool error:', err.message);
    });
    connectPromise = pool.connect().catch((err) => {
      connectPromise = null; // allow a later retry
      throw err;
    });
  }
  return connectPromise;
}

export async function closePool() {
  if (pool.connected) {
    await pool.close();
  }
  connectPromise = null;
}

/**
 * Run a query. `text` must be a parameterised template so user input is
 * always sent as an SQL parameter and never concatenated into the statement.
 *
 * @param {import('mssql').Request} requestOrQuery
 * @param {object} [params]
 */
export function query(requestOrQuery, params) {
  return connect().then(() => sql.query(requestOrQuery, params));
}

/**
 * Run `work` inside a single database transaction, passing it a
 * transaction-scoped Request. Rolls back on any thrown error.
 *
 * @template T
 * @param {(tx: import('mssql').Transaction) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(work) {
  await connect();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => {
      /* the transaction may already be dead; the original error matters more */
    });
    throw err;
  }
}

/** Lightweight health probe used by GET /api/health. */
export async function ping() {
  const started = Date.now();
  await connect();
  await sql.query('SELECT 1 AS ok');
  return { ok: true, latencyMs: Date.now() - started };
}

export { sql };
export default { pool, connect, closePool, query, withTransaction, ping, sql };
