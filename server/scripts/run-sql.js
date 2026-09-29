/**
 * Applies the .sql scripts in order, creating the database first if needed.
 *
 *   node scripts/run-sql.js sql/001_schema.sql sql/002_procedures.sql ...
 *
 * Connecting to `master` lets us CREATE DATABASE, which you cannot do from
 * inside the target database itself.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import env from '../config/env.js';
import { splitBatches } from './splitBatches.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function ensureDatabase() {
  // Only try to create it; ignore "already exists".
  const master = await new sql.ConnectionPool({
    server: env.DB_SERVER,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: {
      encrypt: env.DB_ENCRYPT,
      trustServerCertificate: env.DB_TRUST_CERT,
      enableArithAbort: true,
      connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
    },
  });

  try {
    await master.connect();
    // Bracketed so a hyphenated name is not treated as an expression.
    const name = env.dbName.replace(/\]/g, ']]');
    await master.request().batch(`IF DB_ID(N'${name}') IS NULL CREATE DATABASE [${name}]`);
    console.log(`[db] database "${env.dbName}" is present`);
  } finally {
    await master.close().catch(() => {});
  }
}

async function runScript(file) {
  const full = path.isAbsolute(file) ? file : path.resolve(here, '..', file);
  const text = await fs.readFile(full, 'utf8');
  const batches = splitBatches(text);

  const pool = await sql.connect({
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
      requestTimeout: 120000,
    },
  });

  try {
    for (const [i, batch] of batches.entries()) {
      try {
        await pool.request().batch(batch);
      } catch (err) {
        console.error(`\n[db] ${path.basename(full)} failed on batch ${i + 1}/${batches.length}`);
        console.error(`      ${err.message}`);
        if (err.number) console.error(`      SQL Server error ${err.number}`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`[db] ${path.basename(full)} - ${batches.length} batch(es) applied`);
  } finally {
    await pool.close();
  }
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/run-sql.js <script.sql> [more.sql ...]');
  process.exit(1);
}

try {
  await ensureDatabase();
  for (const file of files) {
    await runScript(file);
    if (process.exitCode) break;
  }
} catch (err) {
  console.error('\n[db] could not run the scripts. Check DB_SERVER / DB_USER / DB_PASSWORD in .env\n');
  console.error(`      ${err.message}\n`);
  process.exit(1);
}
