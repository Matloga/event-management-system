import { request } from './api.js';

export const authService = {
  register: (payload) => request({ method: 'POST', url: '/auth/register', data: payload }),
  login: (credentials) => request({ method: 'POST', url: '/auth/login', data: credentials }),
  logout: () => request({ method: 'POST', url: '/auth/logout' }),
  me: () => request({ method: 'GET', url: '/auth/me' }),
  updateProfile: (payload) => request({ method: 'PATCH', url: '/auth/profile', data: payload }),
  changePassword: (payload) => request({ method: 'POST', url: '/auth/password', data: payload }),
};
