import axios from 'axios';

const TOKEN_KEY = 'ems.token';

/**
 * Shared axios instance.
 *
 * The access token is attached by a request interceptor, and a 401 triggers a
 * single broadcast so the auth context can clear the session. Interceptors
 * keep components free of token plumbing.
 */

export const tokenStore = {
  get: () => {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token) => {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private browsing - the session simply will not persist */
    }
  },
  clear: () => {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Subscribers notified when the server rejects our token. */
const unauthorizedHandlers = new Set();

export function onUnauthorized(handler) {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Normalise every failure into an ApiError with a predictable shape, so UI
 * code can render `error.message` and `error.fieldErrors` without digging
 * through Axios internals.
 */
export class ApiError extends Error {
  constructor({ message, code, status, fieldErrors }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors ?? null;
  }
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const body = error.response?.data;

    if (status === 401) {
      unauthorizedHandlers.forEach((handler) => handler());
    }

    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new ApiError({ message: 'The request timed out. Check your connection.', code: 'timeout' }));
    }
    if (!error.response) {
      return Promise.reject(
        new ApiError({ message: 'Cannot reach the server. Is the backend running?', code: 'network' })
      );
    }

    return Promise.reject(
      new ApiError({
        message: body?.error?.message || 'Something went wrong. Please try again.',
        code: body?.error?.code || 'error',
        status,
        fieldErrors: body?.error?.details?.fields || null,
      })
    );
  }
);

/** Unwraps the API's { success, data, meta } envelope. */
export async function request(config) {
  const response = await api.request(config);
  return { data: response.data.data, meta: response.data.meta, status: response.status };
}

export default api;
