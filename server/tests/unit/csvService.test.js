import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, attendeesToCsv, registrationsToCsv, csvFilename } from '../../services/csvService.js';

test('quotes every cell and doubles embedded quotes', () => {
  const csv = toCsv(['a', 'b'], [['plain', 'has "quote"']]);
  assert.equal(csv, '"a","b"\r\n"plain","has ""quote"""\r\n');
});

test('renders null and undefined as an empty quoted cell', () => {
  const csv = toCsv(['a', 'b'], [[null, undefined]]);
  assert.equal(csv, '"a","b"\r\n"",""\r\n');
});

test('neutralises spreadsheet formula injection', () => {
  // A crafted attendee name must never be evaluated as a formula.
  const csv = toCsv(['name'], [['=1+1'], ['+SUM(A1)'], ['-2+3'], ['@A1']]);
  assert.equal(csv.split('\r\n')[1], '"\'=1+1"');
  assert.equal(csv.split('\r\n')[2], '"\'+SUM(A1)"');
  assert.equal(csv.split('\r\n')[3], '"\'-2+3"');
  assert.equal(csv.split('\r\n')[4], '"\'@A1"');
});

test('commas and newlines inside a cell do not shift columns', () => {
  const csv = toCsv(['a'], [['one, two\nthree']]);
  assert.equal(csv, '"a"\r\n"one, two\nthree"\r\n');
});

const ticket = (over = {}) => ({
  ticketNumber: 'EVT-ABC123-0042',
  status: 'confirmed',
  attendee: { name: 'Thandi Mokoena', email: 'thandi@example.com' },
  registeredAt: '2026-06-01T08:00:00.000Z',
  checkedInAt: null,
  isCheckedIn: false,
  event: {
    title: 'React Workshop',
    date: '2026-07-15',
    venue: 'Conference Hall',
    city: 'Polokwane',
  },
  ...over,
});

test('attendee export carries a provenance header and a BOM', () => {
  const csv = attendeesToCsv([ticket()], { eventTitle: 'React Workshop', generatedAt: new Date('2026-06-01T00:00:00Z') });
  const lines = csv.split('\n');
  assert.match(lines[0], /# React Workshop/);
  assert.match(lines[1], /# Exported 2026-06-01T00:00:00\.000Z/);
  assert.match(lines[2], /# Attendees 1/);
  // Excel needs the BOM immediately before the header row.
  assert.ok(lines[3].startsWith('\uFEFF'), 'expected a BOM before the header row');
  assert.ok(lines[3].startsWith('\uFEFF"Ticket number","Status","Attendee name","Email"'));
  assert.ok(csv.includes('EVT-ABC123-0042'));
  assert.ok(csv.includes('Polokwane'));
});

test('platform export renders check-in state as yes/no', () => {
  const csv = registrationsToCsv([ticket(), ticket({ isCheckedIn: true, checkedInAt: '2026-07-15T09:00:00.000Z' })]);
  const rows = csv.split('\r\n').filter(Boolean);
  assert.equal(rows.length, 3, 'header plus two data rows');
  assert.equal(rows[1].endsWith('"no"'), true);
  assert.equal(rows[2].endsWith('"yes"'), true);
});

test('an empty attendee set still produces a header row', () => {
  const csv = attendeesToCsv([], { eventTitle: 'Empty' });
  assert.ok(csv.includes('"Ticket number","Status"'));
  assert.match(csv, /# Attendees 0/);
});

test('filenames are slugified and date-stamped', () => {
  const name = csvFilename('React Workshop: 2026!', new Date('2026-07-15T00:00:00Z'));
  assert.equal(name, 'react-workshop-2026-2026-07-15');
  assert.equal(csvFilename('***', new Date('2026-07-15T00:00:00Z')), 'export-2026-07-15');
});

test('a long or hostile title cannot produce a path-traversing filename', () => {
  const name = csvFilename('../../etc/passwd');
  assert.equal(name.includes('/'), false);
  assert.equal(name.includes('..'), false);
});
