import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signAccessToken, verifyAccessToken, bearerFromHeader } from '../../services/tokenService.js';

const user = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', email: 'thandi@example.com', role: 'organizer' };

/** Forge a token with the same issuer/audience so the failure is isolated. */
const forge = (payload, { secret = process.env.JWT_SECRET, audience = 'event-management-client' } = {}) =>
  jwt.sign(payload, secret, { issuer: 'event-management-system', audience });

test('signs and verifies a round trip', () => {
  const payload = verifyAccessToken(signAccessToken(user));
  assert.equal(payload.sub, user.id);
  assert.equal(payload.email, user.email);
  assert.equal(payload.role, user.role);
});

test('never embeds a password or hash', () => {
  const claims = JSON.parse(Buffer.from(signAccessToken(user).split('.')[1], 'base64url').toString());
  assert.deepEqual(Object.keys(claims).sort(), ['aud', 'email', 'exp', 'iat', 'iss', 'role', 'sub']);
});

test('rejects a token signed with a different secret', () => {
  assert.throws(
    () => verifyAccessToken(forge({ sub: user.id }, { secret: 'a-completely-different-secret' })),
    /invalid signature/i
  );
});

test('rejects an expired token', () => {
  const expired = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
    expiresIn: '-1s',
    issuer: 'event-management-system',
    audience: 'event-management-client',
  });
  assert.throws(() => verifyAccessToken(expired), /jwt expired/i);
});

test('rejects a tampered payload', () => {
  const [header, , signature] = forge({ sub: user.id }).split('.');
  const tampered = `${header}.${Buffer.from('{"sub":"attacker"}').toString('base64url')}.${signature}`;
  assert.throws(() => verifyAccessToken(tampered));
});

test('rejects a token minted for a different audience', () => {
  assert.throws(() => verifyAccessToken(forge({ sub: user.id }, { audience: 'some-other-app' })), /audience invalid/i);
});

test('rejects garbage', () => {
  for (const bad of ['', 'abc', 'a.b.c', 'a.b', '...']) {
    assert.throws(() => verifyAccessToken(bad), `should reject ${JSON.stringify(bad)}`);
  }
});

test('parses the Authorization header', () => {
  assert.equal(bearerFromHeader('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerFromHeader('bearer abc'), 'abc', 'scheme is case-insensitive');
  assert.equal(bearerFromHeader('BEARER   abc  '), 'abc', 'extra whitespace is tolerated');
});

test('ignores non-bearer schemes and empty values', () => {
  assert.equal(bearerFromHeader('Basic dXNlcjpwYXNz'), null);
  assert.equal(bearerFromHeader('Bearer'), null);
  assert.equal(bearerFromHeader('Bearer    '), null);
  assert.equal(bearerFromHeader(undefined), null);
  assert.equal(bearerFromHeader(''), null);
  assert.equal(bearerFromHeader(12345), null);
});
