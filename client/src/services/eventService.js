import { request } from './api.js';
import { downloadCsv } from './registrationService.js';

export const eventService = {
  /** One request powers the whole landing page. */
  home: () => request({ method: 'GET', url: '/events/home' }),

  list: (params) => request({ method: 'GET', url: '/events', params }),

  mine: (params) => request({ method: 'GET', url: '/events/mine', params }),

  detail: (id) => request({ method: 'GET', url: `/events/${id}` }),

  create: (payload) => request({ method: 'POST', url: '/events', data: payload }),

  update: (id, payload) => request({ method: 'PATCH', url: `/events/${id}`, data: payload }),

  publish: (id, isPublished) =>
    request({ method: 'PATCH', url: `/events/${id}/publish`, data: { isPublished } }),

  feature: (id, isFeatured) =>
    request({ method: 'PATCH', url: `/events/${id}/feature`, data: { isFeatured } }),

  remove: (id) => request({ method: 'DELETE', url: `/events/${id}` }),

  categories: () => request({ method: 'GET', url: '/categories' }),

  cities: () => request({ method: 'GET', url: '/events', params: { limit: 1, sort: 'date_asc' } }),

  register: (id, payload) => request({ method: 'POST', url: `/events/${id}/register`, data: payload }),

  cancelRegistration: (id) => request({ method: 'DELETE', url: `/events/${id}/register` }),

  attendees: (id, params) => request({ method: 'GET', url: `/events/${id}/attendees`, params }),

  reviews: (id) => request({ method: 'GET', url: `/events/${id}/reviews` }),

  addReview: (id, payload) => request({ method: 'POST', url: `/events/${id}/reviews`, data: payload }),

  /** Streams the CSV straight to a download, so it never enters React state. */
  exportAttendees: (id, params = {}) =>
    downloadCsv(
      `/events/${id}/attendees.csv`,
      params,
      'attendees.csv'
    ),
};
