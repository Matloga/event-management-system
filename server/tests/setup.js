/**
 * Loaded with `node --import ./tests/setup.js` before the test runner starts.
 *
 * The unit suite exercises pure logic and must pass on a machine with no
 * .env file and no SQL Server, so the handful of variables the config layer
 * insists on are provided here. Anything already set in the real environment
 * wins, so integration runs against a real database still work.
 */
const defaults = {
  NODE_ENV: 'test',
  DB_SERVER: 'localhost',
  DB_NAME: 'event_management_test',
  DB_USER: 'sa',
  DB_PASSWORD: 'NotUsedByUnitTests',
  DB_ENCRYPT: 'false',
  DB_TRUST_CERT: 'true',
  JWT_SECRET: 'unit-test-secret-0123456789abcdef',
  MAIL_DRIVER: 'json',
  CLIENT_URL: 'http://localhost:5173',
  // Keep bcrypt cheap so the suite stays fast; production uses 12.
  BCRYPT_ROUNDS: '8',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
