import QRCode from 'qrcode';

/**
 * QR ticket payloads.
 *
 * The QR code encodes an opaque random token, never the registration id and
 * never anything guessable. The server resolves that token to a registration.
 * Leaking a photo of a ticket therefore reveals nothing useful on its own.
 *
 * The encoded link points at the web app's /check-in page, not at the API:
 * an attendee's phone camera opens that link, and only a browser route can
 * render the scanner. The API endpoint is POST-only, so a camera hitting it
 * directly would get a 404.
 */

const CHECKIN_PATH = '/check-in';
const TOKEN_PARAM = 'token';
const EVENT_PARAM = 'event';

/**
 * The URL encoded into the ticket QR code, opened by the attendee's camera.
 * @param {{qrToken:string, eventId?:string|null, baseUrl:string}} input
 * @returns {string}
 */
export function buildTicketPayload({ qrToken, eventId, baseUrl }) {
  if (!qrToken) throw new Error('buildTicketPayload requires a qrToken');

  // Resolve relative to the base rather than using a root-absolute path, so a
  // client served from a sub-path (https://example.com/app) still produces a
  // working /app/check-in link.
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const url = new URL(CHECKIN_PATH.replace(/^\//, ''), base);
  url.searchParams.set(TOKEN_PARAM, qrToken);
  if (eventId) url.searchParams.set(EVENT_PARAM, eventId);
  return url.toString();
}

/**
 * Extract the opaque token from whatever the scanner received.
 *
 * A camera hands the scanner page a full ticket URL, but an organiser working
 * from a printed manifest may type the bare token, and some integrations post
 * the URL straight to the API. Accept all three, and never let a caller smuggle
 * a different event in through it: the event is resolved from the token.
 *
 * @param {unknown} input
 * @returns {{token:string, eventId:string|null, wasUrl:boolean}}
 */
export function parseTicketInput(input) {
  if (typeof input !== 'string') return { token: '', eventId: null, wasUrl: false };

  const trimmed = input.trim();
  if (!trimmed) return { token: '', eventId: null, wasUrl: false };

  // Only treat it as a URL if it parses as one; a bare token must survive
  // untouched, since tokens are alphanumeric and could never be a valid URL.
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

/**
 * Render a ticket QR code as an SVG string.
 * @param {string} payload
 * @returns {Promise<string>}
 */
export async function renderQrSvg(payload, { width = 320, margin = 1 } = {}) {
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin,
    width,
    color: { dark: '#18181b', light: '#ffffff' },
  });
}

/**
 * Render as a PNG data URL. Used by the confirmation email so the ticket
 * arrives in the inbox too.
 * @returns {Promise<string>} data:image/png;base64,...
 */
export async function renderQrDataUrl(payload, { width = 320, margin = 1 } = {}) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin,
    width,
    color: { dark: '#18181b', light: '#ffffff' },
  });
}
