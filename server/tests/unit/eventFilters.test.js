import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilters, SELECT_EVENT } from '../../models/eventModel.js';

/**
 * buildFilters is the one place every event query shares, so a mistake here
 * breaks browsing, search and the dashboards at once. These tests pin the
 * contract the SQL depends on.
 */

const VIEWER = { viewerId: 'viewer-1', isAdmin: false };
const ADMIN = { viewerId: 'admin-1', isAdmin: true };

test('anonymous visitors only ever see published events', () => {
  const { clause, params } = buildFilters({});
  assert.match(clause, /e\.is_published = 1/);
  assert.equal(params.viewerId, undefined);
});

test('a signed-in viewer also sees their own drafts', () => {
  const { clause, params } = buildFilters({}, VIEWER);
  assert.match(clause, /e\.is_published = 1 OR e\.organizer_id = @viewerId/);
  assert.equal(params.viewerId, 'viewer-1');
});

test('admins are not filtered by publication at all', () => {
  const { clause } = buildFilters({}, ADMIN);
  assert.doesNotMatch(clause, /is_published/);
});

test('the category join is not emitted, so SELECT_EVENT stays valid', () => {
  // SELECT_EVENT already joins dbo.categories as `c`. Emitting a second join
  // with the same alias makes SQL Server fail with "same exposed names",
  // which would break every listing endpoint.
  const { joins } = buildFilters({ category: 'music' });
  assert.equal(joins, undefined);
  assert.doesNotMatch(SELECT_EVENT, /FROM dbo\.events e\s+INNER JOIN dbo\.categories c[\s\S]*INNER JOIN dbo\.categories c/);
});

test('mineOnly pins ownership independently of the date scope', () => {
  const { clause, params } = buildFilters({ mineOnly: true, scope: 'upcoming' }, VIEWER);
  assert.match(clause, /e\.organizer_id = @viewerId/);
  assert.match(clause, /e\.event_date >= CAST\(GETDATE\(\) AS DATE\)/);
  assert.equal(params.viewerId, 'viewer-1');
});

test('mineOnly alone is enough to scope to the owner', () => {
  const { clause } = buildFilters({ mineOnly: true }, VIEWER);
  assert.match(clause, /e\.organizer_id = @viewerId/);
  assert.doesNotMatch(clause, /event_date/);
});

test('requesting your own events without a session is rejected', () => {
  assert.throws(() => buildFilters({ mineOnly: true }, {}), /Sign in/);
  assert.throws(() => buildFilters({ scope: 'mine' }, {}), /Sign in/);
});

test('search is matched against title, description, venue, city and category', () => {
  const { clause, params } = buildFilters({ search: 'jazz' });
  assert.match(clause, /e\.title LIKE @search/);
  assert.match(clause, /e\.description LIKE @search/);
  assert.match(clause, /e\.venue LIKE @search/);
  assert.match(clause, /e\.city LIKE @search/);
  assert.match(clause, /c\.name LIKE @search/);
  assert.equal(params.search, '%jazz%');
});

test('city matches from the start of the name, not anywhere in it', () => {
  const { params } = buildFilters({ city: 'Polokwane' });
  assert.equal(params.city, 'Polokwane%');
});

test('pricing filters map to the right comparison', () => {
  assert.match(buildFilters({ pricing: 'free' }).clause, /e\.price = 0/);
  assert.match(buildFilters({ pricing: 'paid' }).clause, /e\.price > 0/);
  assert.throws(() => buildFilters({ pricing: 'rent' }).clause, /Unknown pricing filter/);
});

test('empty and null filters are ignored rather than producing bad SQL', () => {
  // Checked as an admin so the visibility predicate does not mask the result.
  const { clause } = buildFilters(
    { search: '', city: null, category: undefined, scope: '', pricing: '', minPrice: null },
    ADMIN
  );
  assert.equal(clause, '');
});

test('a known scope becomes a date or flag predicate', () => {
  assert.match(buildFilters({ scope: 'past' }).clause, /e\.event_date < CAST/);
  assert.match(buildFilters({ scope: 'drafts' }).clause, /e\.is_published = 0/);
  assert.match(buildFilters({ scope: 'featured' }).clause, /e\.is_featured = 1/);
  assert.throws(() => buildFilters({ scope: 'nonsense' }).clause, /Unknown scope/);
});

test('the clause is only present when there is something to filter on', () => {
  // An admin has no implicit visibility filter, so this is the only way to
  // observe the "no WHERE clause at all" case.
  assert.equal(buildFilters({}, ADMIN).clause, '');
  assert.match(buildFilters({ scope: 'upcoming' }, ADMIN).clause, /WHERE/);
});
