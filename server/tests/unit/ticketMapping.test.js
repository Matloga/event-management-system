import test from 'node:test';
import assert from 'node:assert/strict';
import { toTicket } from '../../models/registrationModel.js';

const row = (over = {}) => ({
  id: 'r1',
  event_id: 'e1',
  user_id: 'u1',
  status: 'CONFIRMED',
  ticket_number: 'EVT-ABC123-0042',
  qr_token: 'super-secret-token',
  checked_in_at: null,
  registered_at: '2026-06-01 08:00:00.000',
  cancelled_at: null,
  event_title: 'React Workshop',
  event_description: 'Hands-on React.',
  venue: 'Conference Hall',
  address: null,
  city: 'Polokwane',
  country: 'South Africa',
  image_url: null,
  capacity: 100,
  event_date: '2026-07-15',
  start_time: '09:00:00',
  end_time: '16:00:00',
  organizer_name: 'Tech Society',
  category_name: 'Technology',
  category_slug: 'technology',
  category_accent: '#4f46e5',
  attendee_name: 'Thandi Mokoena',
  attendee_email: 'thandi@example.com',
  ...over,
});

test('normalises a ticket row', () => {
  const t = toTicket(row());
  assert.equal(t.status, 'confirmed');
  assert.equal(t.ticketNumber, 'EVT-ABC123-0042');
  assert.equal(t.event.date, '2026-07-15');
  assert.equal(t.event.startTime, '09:00');
  assert.equal(t.attendee.email, 'thandi@example.com');
  assert.equal(t.isCheckedIn, false);
});

test('the QR token is withheld unless explicitly requested', () => {
  assert.equal('qrToken' in toTicket(row()), false, 'attendee lists must not leak QR tokens');
  assert.equal(toTicket(row(), { includeQrToken: true }).qrToken, 'super-secret-token');
});

test('check-in state is derived from checked_in_at', () => {
  const t = toTicket(row({ checked_in_at: new Date('2026-07-15T09:01:00Z') }));
  assert.equal(t.isCheckedIn, true);
  assert.equal(t.checkedInAt, new Date('2026-07-15T09:01:00Z').toISOString());
});

test('a cancelled ticket keeps its history', () => {
  const t = toTicket(row({ status: 'CANCELLED', cancelled_at: new Date('2026-06-10T12:00:00Z') }));
  assert.equal(t.status, 'cancelled');
  assert.equal(t.cancelledAt, '2026-06-10T12:00:00.000Z');
});

test('a null row maps to null', () => {
  assert.equal(toTicket(null), null);
});
