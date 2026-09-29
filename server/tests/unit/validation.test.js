import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  updateProfileSchema,
} from '../../validators/authValidators.js';
import {
  attendeesSchema,
  createEventSchema,
  listEventsSchema,
  updateEventSchema,
} from '../../validators/eventValidators.js';
import { fieldErrors } from '../../middleware/errorHandler.js';

const futureDate = (days = 30) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Use the same field-name normalisation the error handler applies to real responses. */
const fieldNames = (error) => Object.keys(fieldErrors(error));

/* ------------------------------------------------------------------ auth */

test('register accepts a well-formed body and lowercases the email', () => {
  const parsed = registerSchema.parse({
    name: '  Thandi Mokoena  ',
    email: '  THANDI@Example.COM ',
    password: 'Str0ngPass',
  });
  assert.equal(parsed.name, 'Thandi Mokoena');
  assert.equal(parsed.email, 'thandi@example.com');
});

test('register rejects a weak password with a specific reason', () => {
  const result = registerSchema.safeParse({ name: 'Valid Name', email: 'a@b.com', password: 'password' });
  assert.equal(result.success, false);
  const messages = result.error.issues.map((i) => i.message).join(' ');
  assert.match(messages, /uppercase/);
  assert.match(messages, /number/);
});

test('register rejects a mass-assignment attempt', () => {
  const result = registerSchema.safeParse({
    name: 'Attacker',
    email: 'a@b.com',
    password: 'Str0ngPass',
    role: 'admin',
  });
  assert.equal(result.success, false);
  assert.deepEqual(fieldNames(result.error), ['_']);
});

test('register rejects a short name and a bad email', () => {
  const result = registerSchema.safeParse({ name: 'A', email: 'nope', password: 'Str0ngPass' });
  assert.equal(result.success, false);
  assert.ok(fieldNames(result.error).includes('name'));
  assert.ok(fieldNames(result.error).includes('email'));
});

test('login does not apply the registration password policy', () => {
  // An account created before a policy change must still be able to sign in.
  assert.equal(loginSchema.safeParse({ email: 'a@b.com', password: 'old' }).success, true);
  assert.equal(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success, false);
});

test('profile update rejects an empty patch', () => {
  assert.equal(updateProfileSchema.safeParse({}).success, false);
  assert.equal(updateProfileSchema.safeParse({ name: 'New Name' }).success, true);
});

test('changing to the same password is refused', () => {
  const result = changePasswordSchema.safeParse({ currentPassword: 'Str0ngPass', newPassword: 'Str0ngPass' });
  assert.equal(result.success, false);
  assert.deepEqual(fieldNames(result.error), ['newPassword']);
});

/* ---------------------------------------------------------------- events */

const validEvent = () => ({
  title: 'React Workshop',
  description: 'A full day of hands-on React, hooks and performance work.',
  categoryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  date: futureDate(),
  startTime: '09:00',
  endTime: '16:00',
  venue: 'Conference Hall',
  city: 'Polokwane',
  capacity: 100,
});

test('create applies defaults', () => {
  const parsed = createEventSchema.parse(validEvent());
  assert.equal(parsed.isPublished, false);
  assert.equal(parsed.isFeatured, false);
  assert.equal(parsed.price, 0);
  assert.equal(parsed.country, 'South Africa');
});

test('create rejects a past date', () => {
  const result = createEventSchema.safeParse({ ...validEvent(), date: '2020-01-01' });
  assert.equal(result.success, false);
  assert.deepEqual(fieldNames(result.error), ['date']);
});

test('create rejects an end time that is not after the start time', () => {
  const result = createEventSchema.safeParse({ ...validEvent(), startTime: '16:00', endTime: '09:00' });
  assert.equal(result.success, false);
  assert.deepEqual(fieldNames(result.error), ['endTime']);
});

test('create allows an event with no end time', () => {
  const input = validEvent();
  delete input.endTime;
  assert.equal(createEventSchema.safeParse(input).success, true);
});

test('create rejects non-numeric and out-of-range capacity', () => {
  assert.equal(createEventSchema.safeParse({ ...validEvent(), capacity: 0 }).success, false);
  assert.equal(createEventSchema.safeParse({ ...validEvent(), capacity: -5 }).success, false);
  assert.equal(createEventSchema.safeParse({ ...validEvent(), capacity: 'many' }).success, false);
  assert.equal(createEventSchema.safeParse({ ...validEvent(), capacity: 12.5 }).success, false);
});

test('create rejects a negative price and a malformed date or time', () => {
  assert.equal(createEventSchema.safeParse({ ...validEvent(), price: -1 }).success, false);
  assert.equal(createEventSchema.safeParse({ ...validEvent(), date: '15/07/2026' }).success, false);
  assert.equal(createEventSchema.safeParse({ ...validEvent(), startTime: '25:00' }).success, false);
  assert.equal(createEventSchema.safeParse({ ...validEvent(), startTime: '9am' }).success, false);
});

test('update requires at least one field', () => {
  assert.equal(updateEventSchema.safeParse({}).success, false);
});

test('update rejects a latitude with no longitude', () => {
  const result = updateEventSchema.safeParse({ latitude: -23.9 });
  assert.equal(result.success, false);
  assert.deepEqual(fieldNames(result.error), ['longitude']);
  assert.equal(updateEventSchema.safeParse({ latitude: -23.9, longitude: 29.4 }).success, true);
});

/* ---------------------------------------------------------- list queries */

test('list defaults to page 1, 12 per page, sorted by date', () => {
  const parsed = listEventsSchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 12);
  assert.equal(parsed.sort, 'date_asc');
});

test('list caps the page size so a client cannot dump the table', () => {
  assert.equal(listEventsSchema.safeParse({ limit: 1000 }).success, false);
  assert.equal(listEventsSchema.parse({ limit: '100' }).limit, 100);
});

test('list rejects an inverted date range', () => {
  const result = listEventsSchema.safeParse({ from: '2026-08-01', to: '2026-07-01' });
  assert.equal(result.success, false);
  assert.deepEqual(fieldNames(result.error), ['from']);
});

test('list rejects an inverted price range', () => {
  const result = listEventsSchema.safeParse({ minPrice: 100, maxPrice: 10 });
  assert.equal(result.success, false);
  assert.deepEqual(fieldNames(result.error), ['minPrice']);
});

test('list rejects an unknown sort key instead of passing it to SQL', () => {
  assert.equal(listEventsSchema.safeParse({ sort: 'cheapest' }).success, false);
  assert.equal(listEventsSchema.safeParse({ sort: 'date_asc); DROP TABLE events--' }).success, false);
});

test('list rejects unknown query keys', () => {
  assert.equal(listEventsSchema.safeParse({ is_published: 1 }).success, false);
});

test('attendee query defaults to confirmed and a generous page size', () => {
  const parsed = attendeesSchema.parse({});
  assert.equal(parsed.status, 'confirmed');
  assert.equal(parsed.limit, 100);
});
