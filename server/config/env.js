import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

/* Load server/.env first, then the repository root .env as a fallback.
   Real environment variables always win over both. */
loadDotenv({ path: path.resolve(here, '../.env') });
loadDotenv({ path: path.resolve(here, '../../.env'), override: false });

/**
 * Centralised, fail-fast environment configuration.
 *
 * Every required value is validated once at boot so a misconfigured
 * deployment fails immediately with a readable message instead of
 * throwing a confusing error on the first request.
 */

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  /* --- SQL Server --- */
  DB_SERVER: z.string().min(1, 'DB_SERVER is required (e.g. localhost or my-server.database.windows.net)'),
  DB_PORT: z.coerce.number().int().positive().default(1433),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().default(''),
  DB_ENCRYPT: boolish.default(true),
  DB_TRUST_CERT: boolish.default(false),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  /* Separate database used by the integration test suite so a test run can
     never touch development or production data. */
  DB_TEST_NAME: z.string().optional(),

  /* --- Auth --- */
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

  /* --- Client --- */
  CLIENT_URL: z.string().default('http://localhost:5173'),
  /* Public origin of the web app, used to build the link encoded into ticket
     QR codes. A camera opens that link, so it has to resolve to the SPA's
     /check-in page rather than to an API route. Defaults to the first
     CLIENT_URL entry, which is correct in development because Vite proxies
     /api. Set this explicitly when the app and the API are on different hosts. */
  PUBLIC_CLIENT_URL: z.string().optional(),

  /* --- Mail --- */
  MAIL_DRIVER: z.enum(['smtp', 'json', 'console']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: boolish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@events.local'),
  MAIL_FROM_NAME: z.string().default('Event Management System'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  console.error('Copy server/.env.example to server/.env and fill in the values.\n');
  process.exit(1);
}

const raw = parsed.data;

/* CLIENT_URL may list several origins for CORS. The first is the canonical one,
   used for any link a human will open. */
const origins = raw.CLIENT_URL.split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  /** Resolve the database name, allowing the test suite to target its own. */
  dbName: raw.NODE_ENV === 'test' && raw.DB_TEST_NAME ? raw.DB_TEST_NAME : raw.DB_NAME,
  /** CORS allow-list, one entry per origin. */
  allowedOrigins: origins,
  /** Canonical web-app origin, for links a person opens in a browser. */
  clientUrl: (raw.PUBLIC_CLIENT_URL || origins[0] || 'http://localhost:5173').replace(/\/+$/, ''),
};

export default env;
