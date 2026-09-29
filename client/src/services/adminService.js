import { request } from './api.js';
import { eventService } from './eventService.js';
import { downloadCsv } from './registrationService.js';

export const adminService = {
  dashboard: () => request({ method: 'GET', url: '/dashboard' }),

  stats: (days = 30) => request({ method: 'GET', url: '/admin/stats', params: { days } }),

  users: (params) => request({ method: 'GET', url: '/admin/users', params }),

  setRole: (userId, role) =>
    request({ method: 'PATCH', url: `/admin/users/${userId}/role`, data: { role } }),

  events: (params) => request({ method: 'GET', url: '/admin/events', params }),

  removeReview: (reviewId) => request({ method: 'DELETE', url: `/admin/reviews/${reviewId}` }),

  health: () => request({ method: 'GET', url: '/health' }),

  exportRegistrations: () => downloadCsv('/admin/registrations.csv', {}, 'all-registrations.csv'),

  feature: (eventId, isFeatured) => eventService.feature(eventId, isFeatured),
};
