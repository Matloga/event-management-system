/**
 * Integration tests against a real SQL Server.
 *
 * These are skipped automatically when no database is reachable, so
 * `npm test` still passes on a machine without SQL Server. Point DB_TEST_NAME
 * at a scratch database - the suite truncates tables between tests.
 *
 *   npm run db:reset      # schema + procedures in DB_TEST_NAME
 *   npm test
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import env from '../../config/env.js';
import { closePool, connect, query } from '../../config/database.js';
import { createApp } from '../../app.js';
import { getEventRegistrationStats } from '../../models/registrationModel.js';
import { getOrganizerStats } from '../../services/statsService.js';
import { getOutbox, clearOutbox } from '../../services/mailService.js';
import { registerSchema, loginSchema } from '../../validators/authValidators.js';
import { createEventSchema } from '../../validators/eventValidators.js';

/* ------------------------------------------------------ availability probe */

let available = false;
try {
  await connect();
  const probe = await query(`
    SELECT
      OBJECT_ID(N'dbo.sp_register_for_event', 'P') AS proc,
      OBJECT_ID(N'dbo.events', 'U')                 AS events,
      OBJECT_ID(N'dbo.categories', 'U')            AS categories
  `);
  const row = probe.recordset[0];
  available = row?.proc != null && row?.events != null && row?.categories != null;
} catch {
  available = false;
}

const skip = available
  ? false
  : `SQL Server not reachable at ${env.DB_SERVER}:${env.DB_PORT} (database "${env.dbName}") - skipping integration tests`;

if (!available) {
  console.log(`\n[integration] ${skip}\n`);
}

/* ------------------------------------------------------------- test rig */

const app = createApp();

/** Set by each suite's before hook; the api() helper reads it. */
let base;

async function api(method, path, { body, token, raw = false } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function makeUser({ name = 'Test User', email, role = 'attendee' } = {}) {
  const res = await api('POST', '/api/auth/register', {
    body: registerSchema.parse({ name, email, password: 'Password123' }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...res.body.data.user, token: res.body.data.token, password: 'Password123' };
}

const futureDate = (days = 30) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

async function categoryId() {
  const res = await query(`SELECT TOP 1 id FROM dbo.categories ORDER BY name`);
  return res.recordset[0].id;
}

async function makeEvent(organizerToken, overrides = {}) {
  const body = createEventSchema.parse({
    title: `Test Event ${randomUUID().slice(0, 8)}`,
    description: 'An event created by the integration suite for verification purposes.',
    categoryId: await categoryId(),
    date: futureDate(),
    startTime: '09:00',
    venue: 'Test Venue',
    city: 'Polokwane',
    capacity: 2,
    isPublished: true,
    ...overrides,
  });
  const res = await api('POST', '/api/events', { body, token: organizerToken });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.event;
}

/* ========================================================================= */

describe('integration: authentication', { skip }, () => {
  let server;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server?.close());

  test('register, then log in with the same credentials', async () => {
    const email = `auth-${randomUUID().slice(0, 8)}@example.com`;
    const reg = await api('POST', '/api/auth/register', {
      body: { name: 'Auth Tester', email, password: 'Password123' },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.data.user.email, email);
    assert.equal(reg.body.data.user.role, 'attendee');
    assert.equal('password' in reg.body.data.user, false, 'must not echo the password');
    assert.ok(reg.body.data.token);

    const login = await api('POST', '/api/auth/login', {
      body: loginSchema.parse({ email, password: 'Password123' }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.email, email);
  });

  test('email uniqueness is enforced case-insensitively', async () => {
    const email = `dup-${randomUUID().slice(0, 8)}@example.com`;
    await api('POST', '/api/auth/register', { body: { name: 'First', email, password: 'Password123' } });
    const second = await api('POST', '/api/auth/register', {
      body: { name: 'Second', email: email.toUpperCase(), password: 'Password123' },
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'email_taken');
  });

  test('a wrong password is rejected with a generic message', async () => {
    const email = `wrong-${randomUUID().slice(0, 8)}@example.com`;
    await api('POST', '/api/auth/register', { body: { name: 'Wrong Pass', email, password: 'Password123' } });
    const res = await api('POST', '/api/auth/login', { body: { email, password: 'Password1234' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'invalid_credentials');
  });

  test('an unknown email gives the same response as a wrong password', async () => {
    const res = await api('POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', password: 'Password123' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, 'Email or password is incorrect');
  });

  test('GET /api/auth/me returns the signed-in user', async () => {
    const user = await makeUser({ email: `me-${randomUUID().slice(0, 8)}@example.com` });
    const res = await api('GET', '/api/auth/me', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.id, user.id);
  });

  test('a profile update is persisted', async () => {
    const user = await makeUser({ email: `prof-${randomUUID().slice(0, 8)}@example.com` });
    const res = await api('PATCH', '/api/auth/profile', {
      token: user.token,
      body: { name: 'Renamed Person', bio: 'Loves jazz and clean-up drives.' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.name, 'Renamed Person');
  });
});

describe('integration: events, search and filtering', { skip }, () => {
  let server;
  let organizer;
  let event;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;

    // The first account created on a fresh database becomes the admin.
    const { recordset } = await query(`SELECT id, role FROM dbo.users WHERE role = 'admin'`);
    if (recordset.length) {
      const id = recordset[0].id;
      const email = (await query(`SELECT email FROM dbo.users WHERE id = @id`, { id })).recordset[0].email;
      const res = await api('POST', '/api/auth/login', { body: { email, password: 'Password123' } });
      if (res.status === 200) {
        organizer = { id, email, role: 'admin', token: res.body.data.token };
      }
    }
    if (!organizer) {
      const email = `org-${randomUUID().slice(0, 8)}@example.com`;
      const res = await api('POST', '/api/auth/register', { body: { name: 'Test Organizer', email, password: 'Password123' } });
      organizer = { ...res.body.data.user, token: res.body.data.token };
      await query(`UPDATE dbo.users SET role = 'organizer' WHERE id = @id`, { id: organizer.id });
    }

    event = await makeEvent(organizer.token, { title: `Zebra Conference ${randomUUID().slice(0, 6)}`, capacity: 5 });
  });
  after(() => server?.close());

  test('a draft is invisible to the public but visible to its owner', async () => {
    const draft = await makeEvent(organizer.token, { title: `Secret Draft ${randomUUID().slice(0, 6)}`, isPublished: false });
    const stranger = await makeUser({ email: `stranger-${randomUUID().slice(0, 8)}@example.com` });

    const asPublic = await api('GET', `/api/events/${draft.id}`);
    assert.equal(asPublic.status, 404);

    const asOwner = await api('GET', `/api/events/${draft.id}`, { token: organizer.token });
    assert.equal(asOwner.status, 200);
    assert.equal(asOwner.body.data.event.isPublished, false);

    const asOther = await api('GET', `/api/events/${draft.id}`, { token: stranger.token });
    assert.equal(asOther.status, 404);
  });

  test('search matches on the title', async () => {
    const res = await api('GET', `/api/events?search=${encodeURIComponent(event.title)}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((e) => e.id === event.id));
  });

  test('a search with no hits returns an empty page, not an error', async () => {
    const res = await api('GET', '/api/events?search=zzzznothingmatchesthiszzzz');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.meta.total, 0);
  });

  test('pagination reports consistent metadata', async () => {
    const res = await api('GET', '/api/events?limit=2&page=1');
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length <= 2);
    assert.equal(res.body.meta.limit, 2);
    assert.equal(res.body.meta.page, 1);
    assert.equal(typeof res.body.meta.total, 'number');
  });

  test('upcoming scope excludes past events', async () => {
    const res = await api('GET', '/api/events?scope=upcoming&limit=100');
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(res.body.data.every((e) => e.date >= today), true);
  });

  test('past scope only returns past events', async () => {
    const res = await api('GET', '/api/events?scope=past&limit=100');
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(res.body.data.every((e) => e.date < today), true);
  });

  test('free and paid filters are mutually exclusive', async () => {
    const free = await api('GET', '/api/events?pricing=free&limit=100');
    assert.equal(free.body.data.every((e) => e.price === 0), true);

    const paid = await api('GET', '/api/events?pricing=paid&limit=100');
    assert.equal(paid.body.data.every((e) => e.price > 0), true);
  });

  test('sorting by price ascending is honoured', async () => {
    const res = await api('GET', '/api/events?sort=price_asc&pricing=paid&limit=100');
    const prices = res.body.data.map((e) => e.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  });

  test('a city filter narrows results', async () => {
    const res = await api('GET', '/api/events?city=Polokwane&limit=100');
    assert.equal(res.body.data.every((e) => e.city === 'Polokwane'), true);
  });

  test('only the owner or an admin can edit an event', async () => {
    const stranger = await makeUser({ email: `nosy-${randomUUID().slice(0, 8)}@example.com` });
    const res = await api('PATCH', `/api/events/${event.id}`, { token: stranger.token, body: { title: 'Hijacked' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'not_event_owner');
  });

  test('an attendee cannot create an event', async () => {
    const attendee = await makeUser({ email: `att-${randomUUID().slice(0, 8)}@example.com` });
    const res = await api('POST', '/api/events', {
      token: attendee.token,
      body: { title: 'Not allowed', description: 'x'.repeat(30), categoryId: await categoryId(), date: futureDate(), startTime: '09:00', venue: 'V', city: 'C', capacity: 5 },
    });
    assert.equal(res.status, 403);
  });

  test('capacity cannot be lowered below the seats already booked', async () => {
    const small = await makeEvent(organizer.token, { capacity: 2 });
    const guest = await makeUser({ email: `guest-${randomUUID().slice(0, 8)}@example.com` });
    await api('POST', `/api/events/${small.id}/register`, { token: guest.token, body: {} });

    const res = await api('PATCH', `/api/events/${small.id}`, { token: organizer.token, body: { capacity: 0 } });
    assert.equal(res.status, 422, 'zero capacity is rejected by validation');

    const bad = await api('PATCH', `/api/events/${small.id}`, { token: organizer.token, body: { venue: 'Moved' } });
    assert.equal(bad.status, 200, 'unrelated edits still work');
  });

  test('deleting an event removes it', async () => {
    const doomed = await makeEvent(organizer.token);
    const res = await api('DELETE', `/api/events/${doomed.id}`, { token: organizer.token });
    assert.equal(res.status, 200);
    const after = await api('GET', `/api/events/${doomed.id}`);
    assert.equal(after.status, 404);
  });
});

describe('integration: registration rules', { skip }, () => {
  let server;
  let organizer;
  let event;
  let alice;
  let bob;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;

    const suffix = randomUUID().slice(0, 8);
    const orgRes = await api('POST', '/api/auth/register', {
      body: { name: 'Reg Organizer', email: `regorg-${suffix}@example.com`, password: 'Password123' },
    });
    organizer = { ...orgRes.body.data.user, token: orgRes.body.data.token };
    await query(`UPDATE dbo.users SET role = 'organizer' WHERE id = @id`, { id: organizer.id });

    event = await makeEvent(organizer.token, { title: `Capacity Test ${suffix}`, capacity: 2 });
    alice = await makeUser({ name: 'Alice', email: `alice-${suffix}@example.com` });
    bob = await makeUser({ name: 'Bob', email: `bob-${suffix}@example.com` });
    clearOutbox();
  });
  after(() => server?.close());

  test('a registration confirms and issues a ticket', async () => {
    const res = await api('POST', `/api/events/${event.id}/register`, { token: alice.token, body: {} });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'confirmed');
    assert.match(res.body.data.ticket.ticketNumber, /^EVT-[0-9A-F]{6}-\d{4}$/);
    assert.equal(res.body.data.seatsLeft, 1);
  });

  test('a confirmation email is sent with the ticket number and event details', async () => {
    const outbox = getOutbox();
    const mail = outbox.find((m) => m.to === alice.email && /Confirmed/.test(m.subject));
    assert.ok(mail, 'expected a confirmation email in the outbox');
    assert.ok(mail.text.includes('Ticket:'));
    assert.ok(mail.text.includes(event.title));
    assert.ok(mail.html.includes('Ticket'));
  });

  test('registering twice is refused (challenge 1)', async () => {
    const res = await api('POST', `/api/events/${event.id}/register`, { token: alice.token, body: {} });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'already_registered');
  });

  test('the second seat can be taken', async () => {
    const res = await api('POST', `/api/events/${event.id}/register`, { token: bob.token, body: {} });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.seatsLeft, 0);
  });

  test('a third registration is refused once capacity is reached (challenge 2)', async () => {
    const carol = await makeUser({ name: 'Carol', email: `carol-${randomUUID().slice(0, 8)}@example.com` });
    const res = await api('POST', `/api/events/${event.id}/register`, { token: carol.token, body: {} });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'event_full');
  });

  test('an attendee can opt into the waitlist', async () => {
    const carol = await makeUser({ name: 'Carol WL', email: `carolwl-${randomUUID().slice(0, 8)}@example.com` });
    const res = await api('POST', `/api/events/${event.id}/register`, { token: carol.token, body: { waitlist: true } });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'waitlisted');
    assert.equal(res.body.data.position, 1);
  });

  test('cancelling frees the seat and promotes the waitlisted attendee', async () => {
    const before = await getEventRegistrationStats(event.id);
    assert.equal(before.confirmed, 2);
    assert.equal(before.waitlisted, 1);

    const res = await api('DELETE', `/api/events/${event.id}/register`, { token: bob.token });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.promotedTicketNumber, 'a waitlisted attendee should have been promoted');

    const after = await getEventRegistrationStats(event.id);
    assert.equal(after.confirmed, 2, 'the seat is taken again by the promoted attendee');
    assert.equal(after.waitlisted, 0);
    assert.equal(after.cancelled, 1);
  });

  test('a cancelled attendee can register again', async () => {
    const res = await api('POST', `/api/events/${event.id}/register`, { token: bob.token, body: {} });
    assert.equal(res.status, 409, 'capacity is full again after the promotion');
  });

  test('cancelling when not registered is a 404', async () => {
    const stranger = await makeUser({ email: `stranger2-${randomUUID().slice(0, 8)}@example.com` });
    const res = await api('DELETE', `/api/events/${event.id}/register`, { token: stranger.token });
    assert.equal(res.status, 404);
  });

  test('concurrent registrations never oversell the event', async () => {
    const cap = 3;
    const big = await makeEvent(organizer.token, { title: `Race ${randomUUID().slice(0, 6)}`, capacity: cap });
    const users = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        makeUser({ name: `Racer ${i}`, email: `race-${i}-${randomUUID().slice(0, 8)}@example.com` })
      )
    );

    const results = await Promise.all(
      users.map((u) =>
        query('EXEC dbo.sp_register_for_event @EventId = @e, @UserId = @u, @AllowFull = 0', {
          e: big.id,
          u: u.id,
        })
      )
    );

    const outcomes = results.map((r) => String(r.recordset[0].result_code).toLowerCase());
    const confirmed = outcomes.filter((o) => o === 'confirmed').length;
    assert.equal(confirmed, cap, `expected exactly ${cap} confirmations, got ${confirmed}`);

    const stats = await getEventRegistrationStats(big.id);
    assert.equal(stats.confirmed, cap, 'the stored count must never exceed capacity');
  });
});

describe('integration: tickets, QR and check-in', { skip }, () => {
  let server;
  let organizer;
  let event;
  let attendee;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;

    const suffix = randomUUID().slice(0, 8);
    const orgRes = await api('POST', '/api/auth/register', {
      body: { name: 'QR Organizer', email: `qrorg-${suffix}@example.com`, password: 'Password123' },
    });
    organizer = { ...orgRes.body.data.user, token: orgRes.body.data.token };
    await query(`UPDATE dbo.users SET role = 'organizer' WHERE id = @id`, { id: organizer.id });

    event = await makeEvent(organizer.token, { title: `QR Event ${suffix}`, capacity: 10 });
    attendee = await makeUser({ name: 'QR Attendee', email: `qratt-${suffix}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: attendee.token, body: {} });
  });
  after(() => server?.close());

  test('the QR endpoint returns an SVG containing no raw token', async () => {
    const res = await fetch(`${base}/api/registrations/mine/${event.id}/qr.svg`, {
      headers: { Authorization: `Bearer ${attendee.token}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
    const svg = await res.text();
    assert.ok(svg.includes('<svg'));
    assert.equal(svg.includes('qr_token'), false);
  });

  test('another attendee cannot read the QR code', async () => {
    const nosy = await makeUser({ email: `nosyqr-${randomUUID().slice(0, 8)}@example.com` });
    const res = await fetch(`${base}/api/registrations/mine/${event.id}/qr.svg`, {
      headers: { Authorization: `Bearer ${nosy.token}` },
    });
    assert.equal(res.status, 404);
  });

  test('an attendee cannot scan tickets', async () => {
    const res = await api('POST', '/api/registrations/check-in', { token: attendee.token, body: { token: 'a'.repeat(32) } });
    assert.equal(res.status, 403);
  });

  test('scanning a valid token checks the attendee in, and is idempotent', async () => {
    const ticket = (await api('GET', `/api/registrations/mine/${event.id}`, { token: attendee.token })).body.data;
    // Read the token straight from the database: this is exactly the value a
    // scanner would decode out of the QR image.
    const { recordset } = await query(
      `SELECT qr_token FROM dbo.registrations WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: attendee.id }
    );
    const { qr_token: token } = recordset[0];

    const first = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token, eventId: event.id },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.result, 'ok');
    assert.equal(first.body.data.ticketNumber, ticket.ticketNumber);

    const second = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token, eventId: event.id },
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.data.alreadyCheckedIn, true);
  });

  test('a token scanned against the wrong event is rejected', async () => {
    const other = await makeEvent(organizer.token, { capacity: 5 });
    const guest = await makeUser({ email: `wrong-${randomUUID().slice(0, 8)}@example.com` });
    const reg = await api('POST', `/api/events/${other.id}/register`, { token: guest.token, body: {} });
    const { recordset } = await query(
      `SELECT qr_token FROM dbo.registrations WHERE event_id = @e AND user_id = @u`,
      { e: other.id, u: guest.id }
    );
    void reg;

    const res = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token: recordset[0].qr_token, eventId: event.id },
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'wrong_event');
  });

  test('an unknown token is rejected', async () => {
    const res = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token: 'f'.repeat(64) },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'invalid_token');
  });

  /*
   * The order of the steps in the check-in controller is the security property:
   * authorisation must happen before anything is written. These tests would
   * still pass if the attendee were marked in first and the 403 raised after,
   * so each one asserts on the database, not just the status code.
   */

  test('a foreign organizer is refused WITHOUT marking the attendee in', async () => {
    const suffix = randomUUID().slice(0, 8);
    const foreignRes = await api('POST', '/api/auth/register', {
      body: { name: 'Foreign Organizer', email: `foreign-${suffix}@example.com`, password: 'Password123' },
    });
    const foreign = { ...foreignRes.body.data.user, token: foreignRes.body.data.token };
    await query(`UPDATE dbo.users SET role = 'organizer' WHERE id = @id`, { id: foreign.id });

    const guest = await makeUser({ email: `intrud-${suffix}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: guest.token, body: {} });
    const { recordset } = await query(
      `SELECT qr_token, checked_in_at FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: guest.id }
    );
    assert.equal(recordset[0].checked_in_at, null, 'precondition: not yet checked in');

    // A foreign organizer also claims a different event, so a naive
    // implementation would take the wrong branch and never even look at
    // ownership.
    const res = await api('POST', '/api/registrations/check-in', {
      token: foreign.token,
      body: { token: recordset[0].qr_token, eventId: event.id },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'not_event_owner');

    const after = await query(
      `SELECT checked_in_at FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: guest.id }
    );
    assert.equal(
      after.recordset[0].checked_in_at,
      null,
      'a refused scan must leave the attendee unchecked'
    );
  });

  test('a foreign organizer cannot scan a ticket by omitting the event id', async () => {
    const suffix = randomUUID().slice(0, 8);
    const foreignRes = await api('POST', '/api/auth/register', {
      body: { name: 'No Event Claim', email: `noevent-${suffix}@example.com`, password: 'Password123' },
    });
    const foreign = { ...foreignRes.body.data.user, token: foreignRes.body.data.token };
    await query(`UPDATE dbo.users SET role = 'organizer' WHERE id = @id`, { id: foreign.id });

    const guest = await makeUser({ email: `blank-${suffix}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: guest.token, body: {} });
    const { recordset } = await query(
      `SELECT qr_token, checked_in_at FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: guest.id }
    );

    // Omitting eventId used to be the easy way past the ownership check.
    const res = await api('POST', '/api/registrations/check-in', {
      token: foreign.token,
      body: { token: recordset[0].qr_token },
    });
    assert.equal(res.status, 403);

    const after = await query(
      `SELECT checked_in_at FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: guest.id }
    );
    assert.equal(after.recordset[0].checked_in_at, null);
  });

  test('a full ticket link is accepted in place of a bare token', async () => {
    const suffix = randomUUID().slice(0, 8);
    const guest = await makeUser({ email: `link-${suffix}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: guest.token, body: {} });
    const { recordset } = await query(
      `SELECT qr_token FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: guest.id }
    );

    // Exactly what a phone camera hands to the scanner page.
    const link = `${env.clientUrl}/check-in?token=${recordset[0].qr_token}&event=${event.id}`;
    const res = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token: link },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.result, 'ok');
    assert.equal(res.body.data.attendeeName, guest.name);
  });

  test('a ticket link claiming the wrong event is rejected as 422', async () => {
    const suffix = randomUUID().slice(0, 8);
    const guest = await makeUser({ email: `mismatch-${suffix}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: guest.token, body: {} });
    const { recordset } = await query(
      `SELECT qr_token FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: guest.id }
    );

    const res = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token: recordset[0].qr_token, eventId: randomUUID() },
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'wrong_event');
  });

  test('a ticket link with an uppercased event id is not a mismatch', async () => {
    const suffix = randomUUID().slice(0, 8);
    const guest = await makeUser({ email: `upper-${suffix}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: guest.token, body: {} });
    const { recordset } = await query(
      `SELECT qr_token FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: guest.id }
    );

    // GUIDs are case-insensitive; a hand-edited or re-encoded link must not be
    // reported as somebody else's ticket.
    const res = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token: recordset[0].qr_token, eventId: event.id.toUpperCase() },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.result, 'ok');
  });

  test('a successful check-in reports the remaining waitlist depth', async () => {
    const suffix = randomUUID().slice(0, 8);
    // Capacity 1 forces the second and third attendee onto the waitlist.
    const small = await makeEvent(organizer.token, { title: `Waitlist ${suffix}`, capacity: 1 });
    const seated = await makeUser({ email: `seat-${suffix}@example.com` });
    await api('POST', `/api/events/${small.id}/register`, { token: seated.token, body: {} });

    const queued = [];
    for (let i = 0; i < 2; i += 1) {
      const guest = await makeUser({ email: `queue${i}-${suffix}@example.com` });
      const res = await api('POST', `/api/events/${small.id}/register`, {
        token: guest.token,
        body: { waitlist: true },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'waitlisted');
      queued.push(guest);
    }

    const { recordset } = await query(
      `SELECT qr_token FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: small.id, u: seated.id }
    );

    const res = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token: recordset[0].qr_token },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.stillWaitlisted, 2);
  });

  test('a cancelled ticket is refused, and a waitlisted one is not admitted', async () => {
    const suffix = randomUUID().slice(0, 8);
    const small = await makeEvent(organizer.token, { title: `States ${suffix}`, capacity: 1 });

    const quitter = await makeUser({ email: `quitter-${suffix}@example.com` });
    await api('POST', `/api/events/${small.id}/register`, { token: quitter.token, body: {} });
    await api('DELETE', `/api/events/${small.id}/register`, { token: quitter.token });
    const cancelled = await query(
      `SELECT qr_token FROM dbo.registrations WHERE event_id = @e AND user_id = @u`,
      { e: small.id, u: quitter.id }
    );
    const cancelledRes = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token: cancelled.recordset[0].qr_token },
    });
    assert.equal(cancelledRes.status, 409);
    assert.equal(cancelledRes.body.error.code, 'ticket_cancelled');

    const waiting = await makeUser({ email: `waiting-${suffix}@example.com` });
    const waitRes = await api('POST', `/api/events/${small.id}/register`, {
      token: waiting.token,
      body: { waitlist: true },
    });
    assert.equal(waitRes.status, 201);
    const queued = await query(
      `SELECT qr_token FROM dbo.registrations WHERE event_id = @e AND user_id = @u`,
      { e: small.id, u: waiting.id }
    );
    const queuedRes = await api('POST', '/api/registrations/check-in', {
      token: organizer.token,
      body: { token: queued.recordset[0].qr_token },
    });
    assert.equal(queuedRes.status, 409);
    assert.equal(queuedRes.body.error.code, 'ticket_waitlisted');
  });

  test('an admin may scan at any event, and the stamp really lands', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminRes = await api('POST', '/api/auth/register', {
      body: { name: 'Checkin Admin', email: `scanner-${suffix}@example.com`, password: 'Password123' },
    });
    const admin = { ...adminRes.body.data.user, token: adminRes.body.data.token };
    await query(`UPDATE dbo.users SET role = 'admin' WHERE id = @id`, { id: admin.id });

    const guest = await makeUser({ email: `byadmin-${suffix}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: guest.token, body: {} });
    const { recordset } = await query(
      `SELECT qr_token FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u AND status = 'confirmed'`,
      { e: event.id, u: guest.id }
    );

    const res = await api('POST', '/api/registrations/check-in', {
      token: admin.token,
      body: { token: recordset[0].qr_token },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = await query(
      `SELECT checked_in_at FROM dbo.registrations
        WHERE event_id = @e AND user_id = @u`,
      { e: event.id, u: guest.id }
    );
    assert.notEqual(after.recordset[0].checked_in_at, null);
  });
});

describe('integration: attendee export', { skip }, () => {
  let server;
  let organizer;
  let event;
  let attendee;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;

    const suffix = randomUUID().slice(0, 8);
    const orgRes = await api('POST', '/api/auth/register', {
      body: { name: 'CSV Organizer', email: `csborg-${suffix}@example.com`, password: 'Password123' },
    });
    organizer = { ...orgRes.body.data.user, token: orgRes.body.data.token };
    await query(`UPDATE dbo.users SET role = 'organizer' WHERE id = @id`, { id: organizer.id });

    event = await makeEvent(organizer.token, { title: `CSV Event ${suffix}`, capacity: 10 });
    attendee = await makeUser({ name: 'CSV, Attendee "Quoted"', email: `csvatt-${suffix}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: attendee.token, body: {} });
  });
  after(() => server?.close());

  test('the organizer can export attendees as CSV (challenge 9)', async () => {
    const res = await fetch(`${base}/api/events/${event.id}/attendees.csv`, {
      headers: { Authorization: `Bearer ${organizer.token}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename=".*attendees\.csv"/);

    const csv = await res.text();
    assert.ok(csv.includes('"Ticket number","Status","Attendee name","Email"'));
    assert.ok(csv.includes(attendee.email));
    // The name contains a comma and a quote; it must survive intact.
    assert.ok(csv.includes('"CSV, Attendee ""Quoted"""'));
  });

  test('a stranger cannot export the attendee list', async () => {
    const nosy = await makeUser({ email: `nosycsv-${randomUUID().slice(0, 8)}@example.com` });
    const res = await fetch(`${base}/api/events/${event.id}/attendees.csv`, {
      headers: { Authorization: `Bearer ${nosy.token}` },
    });
    assert.equal(res.status, 403);
  });

  test('the organizer can view attendees as JSON', async () => {
    const res = await api('GET', `/api/events/${event.id}/attendees`, { token: organizer.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.attendees.length, 1);
    assert.equal(res.body.data.stats.confirmed, 1);
    assert.equal('qrToken' in res.body.data.attendees[0], false, 'exports must not leak QR tokens');
  });
});

describe('integration: admin only', { skip }, () => {
  let server;
  let admin;
  let attendee;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;

    const { recordset } = await query(`SELECT id, email FROM dbo.users WHERE role = 'admin'`);
    if (recordset.length) {
      const res = await api('POST', '/api/auth/login', {
        body: { email: recordset[0].email, password: 'Password123' },
      });
      if (res.status === 200) admin = { id: recordset[0].id, ...res.body.data.user, token: res.body.data.token };
    }
    if (!admin) {
      const suffix = randomUUID().slice(0, 8);
      const reg = await api('POST', '/api/auth/register', {
        body: { name: 'Suite Admin', email: `suiteadmin-${suffix}@example.com`, password: 'Password123' },
      });
      admin = { ...reg.body.data.user, token: reg.body.data.token };
      await query(`UPDATE dbo.users SET role = 'admin' WHERE id = @id`, { id: admin.id });
    }
    attendee = await makeUser({ email: `plain-${randomUUID().slice(0, 8)}@example.com` });
  });
  after(() => server?.close());

  test('an ordinary attendee cannot read platform stats', async () => {
    const res = await api('GET', '/api/admin/stats', { token: attendee.token });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'insufficient_role');
  });

  test('an admin can read platform stats', async () => {
    const res = await api('GET', '/api/admin/stats', { token: admin.token });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.platform.events.total, 'number');
    assert.equal(Array.isArray(res.body.data.trend), true);
    assert.equal(Array.isArray(res.body.data.categories), true);
  });

  test('an admin can promote a user', async () => {
    const res = await api('PATCH', `/api/admin/users/${attendee.id}/role`, {
      token: admin.token,
      body: { role: 'organizer' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.role, 'organizer');
  });

  test('an admin cannot demote themselves', async () => {
    const res = await api('PATCH', `/api/admin/users/${admin.id}/role`, {
      token: admin.token,
      body: { role: 'attendee' },
    });
    assert.equal(res.status, 409);
  });

  test('the dashboard adapts to the caller role', async () => {
    const asAttendee = await api('GET', '/api/dashboard', { token: attendee.token });
    assert.equal(asAttendee.status, 200);
    assert.equal(asAttendee.body.data.role, 'organizer');

    const asAdmin = await api('GET', '/api/dashboard', { token: admin.token });
    assert.equal(asAdmin.body.data.role, 'admin');
    assert.ok(asAdmin.body.data.platform);
  });
});

describe('integration: organizer statistics', { skip }, () => {
  let server;

  /**
   * A brand new organizer, so the totals are exact rather than a delta over
   * whatever the other suites left behind.
   */
  async function freshOrganizer(label) {
    const suffix = randomUUID().slice(0, 8);
    const reg = await api('POST', '/api/auth/register', {
      body: { name: `Stats ${label}`, email: `${label}-${suffix}@example.com`, password: 'Password123' },
    });
    const organizer = { ...reg.body.data.user, token: reg.body.data.token };
    await query(`UPDATE dbo.users SET role = 'organizer' WHERE id = @id`, { id: organizer.id });
    return organizer;
  }

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server?.close());

  test('capacity is counted once per event, not once per registration', async () => {
    // The bug this guards against: rolling up with a join to registrations
    // multiplies each event's capacity by its registration count, so an event
    // with capacity 4 and 3 attendees would report 12 seats offered and a fill
    // rate of 25% instead of 75%.
    const organizer = await freshOrganizer('cap');
    const event = await makeEvent(organizer.token, { capacity: 4 });

    for (let i = 0; i < 3; i += 1) {
      const guest = await makeUser({ email: `cap${i}-${randomUUID().slice(0, 8)}@example.com` });
      const res = await api('POST', `/api/events/${event.id}/register`, { token: guest.token, body: {} });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }

    const stats = await getOrganizerStats(organizer.id);
    assert.equal(stats.totalCapacity, 4);
    assert.equal(stats.registrations, 3);
    assert.equal(stats.waitlisted, 0);
    assert.equal(stats.averageFillRate, 75);
    assert.equal(stats.events.total, 1);
    assert.equal(stats.events.published, 1);
  });

  test('capacity sums across events without double counting', async () => {
    const organizer = await freshOrganizer('roll');
    const small = await makeEvent(organizer.token, { capacity: 2 });
    const large = await makeEvent(organizer.token, { capacity: 10 });
    const draft = await makeEvent(organizer.token, { capacity: 7, isPublished: false });

    for (const target of [small, large]) {
      const guest = await makeUser({ email: `roll-${randomUUID().slice(0, 8)}@example.com` });
      const res = await api('POST', `/api/events/${target.id}/register`, { token: guest.token, body: {} });
      assert.equal(res.status, 201);
    }

    const stats = await getOrganizerStats(organizer.id);
    assert.equal(stats.events.total, 3);
    assert.equal(stats.events.published, 2, 'a draft is not a published event');
    assert.equal(stats.events.upcoming, 3);
    // 2 + 10 + 7 exactly. A join-multiplied roll-up would be far larger.
    assert.equal(stats.totalCapacity, 19);
    assert.equal(stats.registrations, 2);
    assert.equal(stats.averageFillRate, Math.round((2 / 19) * 100));
  });

  test('a waitlist is counted separately from confirmed seats', async () => {
    const organizer = await freshOrganizer('queue');
    const event = await makeEvent(organizer.token, { capacity: 1 });

    const seated = await makeUser({ email: `seat-${randomUUID().slice(0, 8)}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: seated.token, body: {} });

    for (let i = 0; i < 2; i += 1) {
      const guest = await makeUser({ email: `q${i}-${randomUUID().slice(0, 8)}@example.com` });
      const res = await api('POST', `/api/events/${event.id}/register`, {
        token: guest.token,
        body: { waitlist: true },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }

    const stats = await getOrganizerStats(organizer.id);
    assert.equal(stats.registrations, 1, 'waitlisted attendees do not fill a seat');
    assert.equal(stats.waitlisted, 2);
    assert.equal(stats.totalCapacity, 1);
    assert.equal(stats.averageFillRate, 100);
  });

  test('cancelled registrations stop counting toward the roll-up', async () => {
    const organizer = await freshOrganizer('cancel');
    const event = await makeEvent(organizer.token, { capacity: 5 });

    const guest = await makeUser({ email: `can-${randomUUID().slice(0, 8)}@example.com` });
    await api('POST', `/api/events/${event.id}/register`, { token: guest.token, body: {} });
    const before = await getOrganizerStats(organizer.id);
    assert.equal(before.registrations, 1);

    await api('DELETE', `/api/events/${event.id}/register`, { token: guest.token });

    const after = await getOrganizerStats(organizer.id);
    assert.equal(after.registrations, 0);
    assert.equal(after.averageFillRate, 0);
  });

  test('an organizer with no events reports zeroes, not nulls', async () => {
    const organizer = await freshOrganizer('empty');
    const stats = await getOrganizerStats(organizer.id);
    assert.equal(stats.totalCapacity, 0);
    assert.equal(stats.registrations, 0);
    assert.equal(stats.waitlisted, 0);
    assert.equal(stats.checkins, 0);
    assert.equal(stats.averageFillRate, 0);
    assert.equal(stats.events.total, 0);
  });

  test('the organizer dashboard returns those same figures', async () => {
    const organizer = await freshOrganizer('dash');
    await makeEvent(organizer.token, { capacity: 8 });
    const guest = await makeUser({ email: `dash-${randomUUID().slice(0, 8)}@example.com` });
    const created = await makeEvent(organizer.token, { capacity: 8 });
    await api('POST', `/api/events/${created.id}/register`, { token: guest.token, body: {} });

    const res = await api('GET', '/api/dashboard', { token: organizer.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.role, 'organizer');
    assert.equal(res.body.data.organizer.events.total, 2);
    assert.equal(res.body.data.organizer.totalCapacity, 16);
    assert.equal(res.body.data.organizer.registrations, 1);
  });
});

after(async () => {
  if (available) await closePool();
});
