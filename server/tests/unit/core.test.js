import test from 'node:test';
import assert from 'node:assert/strict';
import { bool, hm, isoDate, lower, num, ymd } from '../../models/mappers.js';
import { pageMeta } from '../../utils/http.js';
import { AppError, conflict, notFound, translateDbError, unauthorized } from '../../utils/errors.js';

test('ymd passes through the SQL CONVERT string unchanged', () => {
  assert.equal(ymd('2026-07-15'), '2026-07-15');
  assert.equal(ymd('2026-07-15 00:00:00.000'), '2026-07-15');
});

test('ymd formats a Date in local time, so the day never shifts', () => {
  // Midnight local must stay the same calendar day. Reading this as UTC would
  // report the previous day in any timezone east of Greenwich.
  const d = new Date(2026, 6, 15, 0, 0, 0);
  assert.equal(ymd(d), '2026-07-15');
});

test('ymd and hm pass null through', () => {
  assert.equal(ymd(null), null);
  assert.equal(hm(null), null);
});

test('hm truncates seconds', () => {
  assert.equal(hm('09:30:00'), '09:30');
  assert.equal(hm('18:05:00'), '18:05');
  assert.equal(hm(new Date(2026, 6, 15, 9, 30, 0)), '09:30');
});

test('bool accepts both driver representations', () => {
  assert.equal(bool(1), true);
  assert.equal(bool(true), true);
  assert.equal(bool(0), false);
  assert.equal(bool(false), false);
  assert.equal(bool(null), false);
});

test('num converts decimals and preserves null', () => {
  assert.equal(num('12.50'), 12.5);
  assert.equal(num(0), 0);
  assert.equal(num(null), null);
});

test('lower normalises SQL Server enums', () => {
  assert.equal(lower('CONFIRMED'), 'confirmed');
  assert.equal(lower(null), null);
});

test('isoDate renders a Date as an ISO string', () => {
  assert.equal(isoDate(new Date('2026-07-15T09:00:00.000Z')), '2026-07-15T09:00:00.000Z');
  assert.equal(isoDate('already-a-string'), 'already-a-string');
  assert.equal(isoDate(null), null);
});

/* ------------------------------------------------------------ page meta */

test('pageMeta derives the page count', () => {
  assert.deepEqual(pageMeta({ page: 1, limit: 12, total: 30 }), {
    page: 1, limit: 12, total: 30, totalPages: 3, hasNext: true, hasPrev: false,
  });
  assert.deepEqual(pageMeta({ page: 3, limit: 12, total: 30 }), {
    page: 3, limit: 12, total: 30, totalPages: 3, hasNext: false, hasPrev: true,
  });
});

test('pageMeta handles an empty result set', () => {
  assert.deepEqual(pageMeta({ page: 1, limit: 12, total: 0 }), {
    page: 1, limit: 12, total: 0, totalPages: 0, hasNext: false, hasPrev: false,
  });
});

/* --------------------------------------------------------------- errors */

test('AppError carries a status and a machine-readable code', () => {
  const err = new AppError('nope', 418, 'teapot');
  assert.equal(err.status, 418);
  assert.equal(err.code, 'teapot');
  assert.equal(err.expected, true);
});

test('the error factories set the right statuses', () => {
  assert.equal(unauthorized().status, 401);
  assert.equal(notFound().status, 404);
  assert.equal(conflict('taken').status, 409);
});

test('translateDbError leaves an AppError untouched', () => {
  const original = conflict('already registered');
  assert.equal(translateDbError(original), original);
});

test('translateDbError maps unique-violation to a 409', () => {
  const err = translateDbError({ number: 2627, message: 'Violation of UNIQUE KEY' });
  assert.equal(err.status, 409);
  assert.equal(err.code, 'duplicate');
});

test('translateDbError maps a check-constraint violation to a 409', () => {
  const err = translateDbError({ number: 547, message: 'The INSERT statement conflicted' });
  assert.equal(err.status, 409);
  assert.equal(err.code, 'constraint_violation');
});

test('an unreachable database becomes a 503, not a 500', () => {
  for (const driver of [
    { code: 'ESOCKET', message: 'Failed to connect to localhost:1433' },
    { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:1433' },
    { message: 'Failed to connect to sql.example.com:1433 - ETIMEDOUT' },
    { message: 'Connection is closed.' },
  ]) {
    const err = translateDbError(driver);
    assert.equal(err.status, 503, `expected 503 for ${JSON.stringify(driver)}`);
    assert.equal(err.code, 'db_unreachable');
  }
});

test('bad database credentials become a 503', () => {
  const err = translateDbError({ message: "Login failed for user 'sa'." });
  assert.equal(err.status, 503);
});

test('an unrecognised database error becomes an opaque 500', () => {
  const err = translateDbError({ number: 999, message: 'something odd' });
  assert.equal(err.status, 500);
  assert.equal(err.code, 'internal_error');
  assert.equal(/something odd/.test(err.message), false, 'driver detail must not leak');
});
