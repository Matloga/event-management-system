/**
 * Ticket input parsing for the door scanner.
 *
 * The camera hands the scanner page a full ticket link, an organiser working
 * from a printed manifest types the bare token, and some third-party scanners
 * post the whole URL. Accept all three.
 *
 * Mirrors the server's parseTicketInput so a token resolves the same way at the
 * door and in the API. The event is read from the link purely to pre-select the
 * right event in the UI - the server always resolves the real event from the
 * token, so a tampered link cannot redirect an attendee.
 */

const TOKEN_PARAM = 'token';
const EVENT_PARAM = 'event';

/**
 * @param {unknown} input
 * @returns {{token: string, eventId: string | null, wasUrl: boolean}}
 */
export function parseTicketInput(input) {
  if (typeof input !== 'string') return { token: '', eventId: null, wasUrl: false };

  const trimmed = input.trim();
  if (!trimmed) return { token: '', eventId: null, wasUrl: false };

  // A token is alphanumeric, so it can never be a valid absolute URL. Only a
  // scheme-prefixed value is worth parsing.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return {
        token: url.searchParams.get(TOKEN_PARAM)?.trim() ?? '',
        eventId: url.searchParams.get(EVENT_PARAM)?.trim() || null,
        wasUrl: true,
      };
    } catch {
      return { token: trimmed, eventId: null, wasUrl: false };
    }
  }

  return { token: trimmed, eventId: null, wasUrl: false };
}
