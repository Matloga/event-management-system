/**
 * Boots the API on an ephemeral port and exercises the routes that do not
 * need a database: validation failures, auth guards, 404s, rate-limit config.
 *
 *   npm run smoke
 *
 * Exits non-zero on the first unexpected result, so it is usable in CI.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.js';

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

await check('GET / returns the API banner', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.name, 'Event Management System API');
});

await check('GET /api/health responds (db may be down)', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(['healthy', 'degraded'].includes(body.data.status));
});

await check('POST /api/auth/register rejects a weak password with 422', async () => {
  const res = await post('/api/auth/register', { name: 'A', email: 'not-an-email', password: 'weak' });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'validation_error');
  assert.ok(body.error.details.fields.email, 'expected a field error for email');
  assert.ok(body.error.details.fields.password, 'expected a field error for password');
});

await check('POST /api/auth/register rejects unknown fields', async () => {
  const res = await post('/api/auth/register', {
    name: 'Valid Name',
    email: 'valid@example.com',
    password: 'Str0ngPass',
    isAdmin: true,
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.error.details.fields._, 'strict mode should reject unknown keys');
});

await check('POST /api/auth/login validates the body', async () => {
  const res = await post('/api/auth/login', {});
  assert.equal(res.status, 422);
});

await check('GET /api/events/:id rejects a malformed uuid', async () => {
  const res = await fetch(`${base}/api/events/not-a-uuid`);
  assert.equal(res.status, 422);
});

await check('GET /api/events rejects an out-of-range page', async () => {
  const res = await fetch(`${base}/api/events?page=0`);
  assert.equal(res.status, 422);
});

await check('GET /api/events rejects an unknown sort key', async () => {
  const res = await fetch(`${base}/api/events?sort=cheapest`);
  assert.equal(res.status, 422);
});

await check('GET /api/auth/me without a token returns 401', async () => {
  const res = await fetch(`${base}/api/auth/me`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'no_session');
});

await check('GET /api/auth/me with a garbage token returns 401', async () => {
  const res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: 'Bearer not.a.jwt' } });
  assert.equal(res.status, 401);
});

await check('POST /api/events without auth returns 401', async () => {
  const res = await post('/api/events', { title: 'Nope' });
  assert.equal(res.status, 401);
});

await check('POST /api/registrations/check-in rejects a short token', async () => {
  const res = await post('/api/registrations/check-in', { token: 'abc' });
  assert.equal(res.status, 401, 'auth guard runs before body validation');
});

await check('GET /api/admin/stats without auth returns 401', async () => {
  const res = await fetch(`${base}/api/admin/stats`);
  assert.equal(res.status, 401);
});

await check('GET /api/categories without auth is public (may fail on db)', async () => {
  const res = await fetch(`${base}/api/categories`);
  assert.ok([200, 503].includes(res.status), `unexpected status ${res.status}`);
});

await check('unknown route returns a 404 envelope', async () => {
  const res = await fetch(`${base}/api/does-not-exist`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'route_not_found');
});

await check('security headers are present', async () => {
  const res = await fetch(`${base}/`);
  assert.ok(res.headers.get('x-content-type-options'), 'expected nosniff');
  assert.equal(res.headers.get('x-powered-by'), null, 'x-powered-by should be disabled');
});

server.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.error}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
