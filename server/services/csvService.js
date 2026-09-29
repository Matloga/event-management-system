/**
 * CSV generation for attendee exports (challenge 9).
 *
 * Everything is quoted and internal quotes doubled, and a leading =, +, - or @
 * is prefixed with a single quote so spreadsheet software treats the cell as
 * text. That stops a crafted attendee name from executing as a formula.
 */

const RISKY_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value) {
  if (value === null || value === undefined) return '""';
  let s = String(value);
  if (RISKY_PREFIX.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toRow(values) {
  return values.map(escapeCell).join(',');
}

/**
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 * @param {string} [eol]
 */
export function toCsv(headers, rows, eol = '\r\n') {
  return [toRow(headers), ...rows.map(toRow)].join(eol) + eol;
}

/** BOM so Excel opens UTF-8 (event titles with accents) correctly. */
export const CSV_BOM = '\uFEFF';

const boolish = (v) => (v ? 'yes' : 'no');

/**
 * Attendee export in the shape organisers actually want.
 * @param {Array<object>} tickets  rows from registrationModel.listEventAttendees
 * @param {{eventTitle?:string, generatedAt?:Date}} meta
 */
export function attendeesToCsv(tickets, meta = {}) {
  const headers = [
    'Ticket number',
    'Status',
    'Attendee name',
    'Email',
    'Registered at',
    'Checked in at',
    'Event date',
    'Event',
    'Venue',
    'City',
  ];

  const rows = tickets.map((t) => [
    t.ticketNumber,
    t.status,
    t.attendee.name,
    t.attendee.email,
    t.registeredAt ?? '',
    t.checkedInAt ?? '',
    t.event.date,
    t.event.title,
    t.event.venue,
    t.event.city,
  ]);

  const header = [
    `# ${meta.eventTitle ?? 'Event'}`,
    `# Exported ${(meta.generatedAt ?? new Date()).toISOString()}`,
    `# Attendees ${tickets.length}`,
  ].join('\n');

  return `${header}\n${CSV_BOM}${toCsv(headers, rows)}`;
}

/** Platform-wide registration export for the admin dashboard. */
export function registrationsToCsv(tickets) {
  const headers = [
    'Ticket number',
    'Status',
    'Attendee',
    'Email',
    'Event',
    'Event date',
    'City',
    'Registered at',
    'Checked in',
  ];

  const rows = tickets.map((t) => [
    t.ticketNumber,
    t.status,
    t.attendee.name,
    t.attendee.email,
    t.event.title,
    t.event.date,
    t.event.city,
    t.registeredAt ?? '',
    boolish(t.isCheckedIn),
  ]);

  return `${CSV_BOM}${toCsv(headers, rows)}`;
}

/** A filesystem-safe filename fragment, e.g. "react-workshop-attendees-2026-07-15". */
export function csvFilename(base, date = new Date()) {
  const slug = String(base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'export';
  return `${slug}-${date.toISOString().slice(0, 10)}`;
}
