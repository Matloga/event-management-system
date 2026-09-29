import test from 'node:test';
import assert from 'node:assert/strict';
import { mapEvent } from '../../models/eventModel.js';

/** A row shaped like the output of SELECT_EVENT. */
const row = (over = {}) => ({
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  title: 'React Workshop',
  description: 'Hands-on React.',
  category_id: 'c1',
  category_name: 'Technology',
  category_slug: 'technology',
  category_accent: '#4f46e5',
  organizer_id: 'o1',
  organizer_name: 'Tech Society',
  organizer_email: 'organizer@example.com',
  event_date: '2026-07-15',
  start_time: '09:00:00',
  end_time: '16:00:00',
  venue: 'Conference Hall',
  address: '12 University Road',
  city: 'Polokwane',
  country: 'South Africa',
  latitude: -23.9,
  longitude: 29.4,
  capacity: 100,
  price: '250.00',
  is_featured: 1,
  is_published: 1,
  image_url: null,
  created_at: new Date('2026-06-01T08:00:00Z'),
  updated_at: new Date('2026-06-02T08:00:00Z'),
  confirmed_count: 30,
  waitlist_count: 4,
  checked_in_count: 12,
  avg_rating: '4.5',
  review_count: 10,
  ...over,
});

test('derives seat availability from capacity and confirmed count', () => {
  const event = mapEvent(row());
  assert.equal(event.capacity, 100);
  assert.equal(event.seatsLeft, 70);
  assert.equal(event.isFull, false);
  assert.equal(event.fillRate, 30);
});

test('a sold-out event reports zero seats left and is full', () => {
  const event = mapEvent(row({ confirmed_count: 100 }));
  assert.equal(event.seatsLeft, 0);
  assert.equal(event.isFull, true);
  assert.equal(event.fillRate, 100);
});

test('over-booking never reports negative seats', () => {
  // Possible if capacity was lowered directly in the database.
  const event = mapEvent(row({ confirmed_count: 105 }));
  assert.equal(event.seatsLeft, 0);
  assert.equal(event.isFull, true);
});

test('a free event is flagged, a priced one is not', () => {
  assert.equal(mapEvent(row({ price: '0.00' })).isFree, true);
  assert.equal(mapEvent(row({ price: '250.00' })).isFree, false);
  assert.equal(mapEvent(row({ price: '250.00' })).price, 250);
});

test('normalises SQL Server types on the way out', () => {
  const event = mapEvent(row({ is_featured: 0, is_published: 1 }));
  assert.equal(event.isFeatured, false);
  assert.equal(event.isPublished, true);
  assert.equal(event.date, '2026-07-15');
  assert.equal(event.startTime, '09:00');
  assert.equal(event.endTime, '16:00');
  assert.equal(event.rating.average, 4.5);
  assert.equal(event.rating.count, 10);
});

test('the waitlist count is reported separately from seats', () => {
  const event = mapEvent(row({ confirmed_count: 100, waitlist_count: 7 }));
  assert.equal(event.seatsLeft, 0);
  assert.equal(event.waitlistCount, 7);
});

test('map location only when both coordinates are present', () => {
  assert.deepEqual(mapEvent(row()).location, { latitude: -23.9, longitude: 29.4 });
  assert.equal(mapEvent(row({ latitude: null })).location, null);
  assert.equal(mapEvent(row({ longitude: null })).location, null);
});

test('management flags are only attached for the owner or an admin', () => {
  const anon = mapEvent(row());
  assert.equal('canManage' in anon, false, 'anonymous visitors get no management hints');

  const owner = mapEvent(row(), { viewerId: 'o1' });
  assert.equal(owner.canManage, true);
  assert.equal(owner.isOwner, true);

  const otherOrganizer = mapEvent(row(), { viewerId: 'someone-else' });
  assert.equal('canManage' in otherOrganizer, false);

  const admin = mapEvent(row(), { viewerId: 'admin-1', isAdmin: true });
  assert.equal(admin.canManage, true);
  assert.equal(admin.isOwner, false, 'an admin manages but does not own');
});

test('a null row maps to null', () => {
  assert.equal(mapEvent(null), null);
});
