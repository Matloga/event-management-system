import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTicketPayload,
  parseTicketInput,
  renderQrSvg,
  renderQrDataUrl,
} from '../../services/qrService.js';

/**
 * Ticket QR payloads and scanner input.
 *
 * The encoded link is opened by an attendee's phone camera, so it has to
 * resolve to a page a browser can render. The API's check-in endpoint is
 * POST-only; a camera that opened it directly would get a 404 and the attendee
 * would be stuck at the door. These tests pin the payload to the web route.
 */

const EVENT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

test('the QR payload points at the scanner page, not the API route', () => {
  const payload = buildTicketPayload({
    qrToken: 'abc123def456',
    eventId: EVENT_ID,
    baseUrl: 'https://events.example.com',
  });
  const url = new URL(payload);
  assert.equal(url.origin, 'https://events.example.com');
  assert.equal(url.pathname, '/check-in');
  assert.equal(url.searchParams.get('token'), 'abc123def456');
  assert.equal(url.searchParams.get('event'), EVENT_ID);
});

test('the payload is never an API endpoint, which a camera could not open', () => {
  const payload = buildTicketPayload({
    qrToken: 'abc123def456',
    eventId: EVENT_ID,
    baseUrl: 'https://events.example.com',
  });
  assert.equal(payload.includes('/api/'), false);
});

test('the payload never contains the registration id or user data', () => {
  const payload = buildTicketPayload({
    qrToken: 'opaque-token-value',
    eventId: null,
    baseUrl: 'http://localhost:5173',
  });
  assert.equal(payload.includes('userId'), false);
  assert.equal(payload.includes('ticket_number'), false);
  assert.ok(payload.includes('token=opaque-token-value'));
});

test('a trailing slash on the base url does not double up', () => {
  const payload = buildTicketPayload({
    qrToken: 't',
    eventId: null,
    baseUrl: 'http://localhost:5173/',
  });
  assert.equal(payload, 'http://localhost:5173/check-in?token=t');
});

test('a client served from a sub-path keeps that prefix', () => {
  const payload = buildTicketPayload({
    qrToken: 't',
    eventId: null,
    baseUrl: 'https://example.com/app',
  });
  assert.equal(new URL(payload).pathname, '/app/check-in');
});

test('a payload with no token is a programming error, not a bad ticket', () => {
  assert.throws(
    () => buildTicketPayload({ qrToken: '', eventId: EVENT_ID, baseUrl: 'https://events.example.com' }),
    /requires a qrToken/
  );
});

/* --- parseTicketInput: what the scanner receives, however it arrives --- */

test('a bare token is accepted as-is', () => {
  assert.deepEqual(parseTicketInput('abc123def456'), {
    token: 'abc123def456',
    eventId: null,
    wasUrl: false,
  });
});

test('a full ticket link yields the token and the event', () => {
  const link = `https://events.example.com/check-in?token=tok_9f2b&event=${EVENT_ID}`;
  assert.deepEqual(parseTicketInput(link), {
    token: 'tok_9f2b',
    eventId: EVENT_ID,
    wasUrl: true,
  });
});

test('surrounding whitespace from a copy-paste is trimmed', () => {
  assert.equal(parseTicketInput('  tok_9f2b \n').token, 'tok_9f2b');
  assert.equal(parseTicketInput(' https://events.example.com/check-in?token=tok_9f2b ').token, 'tok_9f2b');
});

test('a link with no token parses to an empty token so the caller can complain', () => {
  const result = parseTicketInput('https://events.example.com/check-in?event=' + EVENT_ID);
  assert.equal(result.token, '');
  assert.equal(result.eventId, EVENT_ID);
  assert.equal(result.wasUrl, true);
});

test('an empty link is a missing token, not a crash', () => {
  const result = parseTicketInput('https://events.example.com/check-in');
  assert.equal(result.token, '');
  assert.equal(result.eventId, null);
});

test('a link with an empty event id does not send an empty event', () => {
  const result = parseTicketInput('https://events.example.com/check-in?token=t&event=');
  assert.equal(result.token, 't');
  assert.equal(result.eventId, null);
});

test('junk and non-strings never throw', () => {
  for (const value of [undefined, null, 42, {}, [], '', '   ']) {
    assert.deepEqual(parseTicketInput(value), { token: '', eventId: null, wasUrl: false });
  }
});

test('a non-http scheme is treated as an opaque token, not parsed', () => {
  const result = parseTicketInput('javascript:alert(1)');
  assert.equal(result.token, 'javascript:alert(1)');
  assert.equal(result.wasUrl, false);
});

test('a token that merely looks url-ish survives untouched', () => {
  // Tokens are generated as base64url-ish random strings; a token must never be
  // mangled by being mistaken for a URL.
  const result = parseTicketInput('https:tok_9f2b');
  assert.equal(result.token, 'https:tok_9f2b');
  assert.equal(result.eventId, null);
});

test('the payload round-trips through the parser', () => {
  const payload = buildTicketPayload({
    qrToken: 'tok_9f2b-ABC_def.123',
    eventId: EVENT_ID,
    baseUrl: 'https://events.example.com',
  });
  const parsed = parseTicketInput(payload);
  assert.equal(parsed.token, 'tok_9f2b-ABC_def.123');
  assert.equal(parsed.eventId, EVENT_ID);
});

test('renders an SVG', async () => {
  const svg = await renderQrSvg('https://example.com/check-in?token=t');
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('</svg>'));
});

test('renders a PNG data url', async () => {
  const url = await renderQrDataUrl('https://example.com/check-in?token=t');
  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.ok(url.length > 200);
});

test('a long token still produces a valid code', async () => {
  const svg = await renderQrSvg(
    'https://example.com/check-in?token=' + 'a'.repeat(64) + '&event=' + 'b'.repeat(36)
  );
  assert.ok(svg.startsWith('<svg'));
});
