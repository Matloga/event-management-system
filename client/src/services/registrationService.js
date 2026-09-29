import api, { request, tokenStore } from './api.js';

export const registrationService = {
  mine: (scope) => request({ method: 'GET', url: '/registrations/mine', params: { scope } }),

  ticket: (eventId) => request({ method: 'GET', url: `/registrations/mine/${eventId}` }),

  checkIn: (payload) => request({ method: 'POST', url: '/registrations/check-in', data: payload }),

  /**
   * The QR code is rendered server-side as SVG. Fetch it as a blob so the
   * browser can hand it straight to an <img> without a data: URL round trip.
   */
  async qrImage(eventId) {
    const token = tokenStore.get();
    const base = import.meta.env.VITE_API_URL || '/api';
    const response = await fetch(`${base}/registrations/mine/${eventId}/qr.svg`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Could not load the QR code');
    return URL.createObjectURL(await response.blob());
  },
};

/** Downloads a CSV endpoint through the authenticated axios instance. */
export async function downloadCsv(path, params, filename) {
  const response = await api.get(path, { params, responseType: 'blob' });

  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
