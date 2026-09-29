import test from 'node:test';
import assert from 'node:assert/strict';
import { ORGANIZER_STATS_SQL, toOrganizerStats } from '../../services/statsService.js';

/**
 * Organizer roll-up.
 *
 * The bug this pins down: aggregating events and registrations in a single
 * SELECT emits one row per registration, so `SUM(capacity)` counts each event's
 * capacity once per attendee. An event with 4 seats and 3 bookings reported 12
 * seats offered and a 25% fill rate instead of 4 and 75%. There is no database
 * in the unit suite to catch it, so the shape of the SQL is asserted directly.
 */

/**
 * The output clause producing `alias`: a bounded window of the flattened SQL
 * ending at `AS <alias>`. The expressions span several lines and contain commas
 * inside parentheses, so neither a line split nor a comma split works.
 */
function outputClauseFor(alias) {
  const flat = ORGANIZER_STATS_SQL.replace(/\s+/g, ' ').trim();
  const at = flat.toUpperCase().lastIndexOf(`AS ${alias.toUpperCase()}`);
  assert.ok(at >= 0, `no output clause for ${alias}`);
  return flat.slice(Math.max(0, at - 260), at + alias.length + 4);
}

test('registrations are counted per event, never joined into the roll-up', () => {
  // A single-pass JOIN against dbo.registrations is the shape that multiplies
  // capacity; the CTE must be the only source of rows for the outer SUMs.
  assert.match(ORGANIZER_STATS_SQL, /FROM per_event/);
  assert.doesNotMatch(
    ORGANIZER_STATS_SQL,
    /FROM dbo\.events e\s+(?:INNER |LEFT )?JOIN dbo\.registrations/i
  );
  assert.doesNotMatch(ORGANIZER_STATS_SQL, /JOIN dbo\.registrations r\s+ON/i);
});

test('the CTE is restricted to one row per event', () => {
  assert.match(ORGANIZER_STATS_SQL, /WITH per_event AS/);
  assert.match(ORGANIZER_STATS_SQL, /FROM dbo\.events e\s+WHERE e\.organizer_id = @organizerId/);
  // No GROUP BY at the CTE level means one row per event, which is the whole
  // point: SUM(capacity) over it is the sum of distinct capacities.
  assert.doesNotMatch(ORGANIZER_STATS_SQL, /GROUP BY/i);
});

test('the organizer id is a bound parameter, not interpolated', () => {
  assert.match(ORGANIZER_STATS_SQL, /@organizerId/);
  assert.doesNotMatch(ORGANIZER_STATS_SQL, /organizerId\s*=\s*'/i);
});

test('every summed figure is coalesced so a NULL cannot reach the client', () => {
  for (const alias of [
    'published',
    'upcoming',
    'registrations',
    'waitlisted',
    'total_capacity',
    'checkins',
  ]) {
    assert.match(
      outputClauseFor(alias),
      /COALESCE\(/i,
      `${alias} must be coalesced: SUM() over no rows is NULL`
    );
  }
});

test('the event count is a COUNT, which is already 0 rather than NULL', () => {
  // COUNT_BIG(*) over an empty set returns 0, so it needs no COALESCE - and
  // adding one would only hide a genuine mistake.
  const clause = outputClauseFor('events_total');
  assert.match(clause, /COUNT_BIG\(\*\)/i);
  assert.doesNotMatch(clause, /COALESCE/i);
});

/* --- row mapping --- */

test('the driver returns COUNT_BIG and SUM as strings, which are coerced', () => {
  // mssql hands back bigints as strings; without Number() the dashboard would
  // render "3" and break arithmetic.
  const stats = toOrganizerStats({
    events_total: '3',
    published: '2',
    upcoming: '3',
    registrations: '2',
    waitlisted: '4',
    total_capacity: '19',
    checkins: '1',
  });
  assert.equal(stats.events.total, 3);
  assert.equal(stats.events.published, 2);
  assert.equal(stats.events.upcoming, 3);
  assert.equal(stats.registrations, 2);
  assert.equal(stats.waitlisted, 4);
  assert.equal(stats.checkins, 1);
  assert.equal(stats.totalCapacity, 19);
});

test('the fill rate is registrations over capacity, rounded', () => {
  assert.equal(toOrganizerStats({ registrations: '3', total_capacity: '4' }).averageFillRate, 75);
  assert.equal(toOrganizerStats({ registrations: '2', total_capacity: '19' }).averageFillRate, 11);
  assert.equal(toOrganizerStats({ registrations: '1', total_capacity: '1' }).averageFillRate, 100);
  assert.equal(toOrganizerStats({ registrations: '1', total_capacity: '8' }).averageFillRate, 13);
});

test('an organizer with no events yields zeroes rather than NaN', () => {
  const stats = toOrganizerStats({});
  assert.equal(stats.totalCapacity, 0);
  assert.equal(stats.registrations, 0);
  assert.equal(stats.waitlisted, 0);
  assert.equal(stats.checkins, 0);
  assert.equal(stats.events.total, 0);
  assert.equal(stats.events.published, 0);
  assert.equal(stats.events.upcoming, 0);
  // The important one: 0/0 must not reach the client as NaN.
  assert.equal(stats.averageFillRate, 0);
  assert.equal(Number.isNaN(stats.averageFillRate), false);
});

test('a missing row is handled the same as an empty one', () => {
  assert.deepEqual(toOrganizerStats(undefined), toOrganizerStats({}));
  assert.deepEqual(toOrganizerStats(), toOrganizerStats({}));
});

test('over-capacity registrations do not produce a nonsensical rate', () => {
  // Only possible if data is edited directly, but the dashboard must not render
  // something absurd if it happens.
  const stats = toOrganizerStats({ registrations: '5', total_capacity: '0' });
  assert.equal(stats.averageFillRate, 0);
});
