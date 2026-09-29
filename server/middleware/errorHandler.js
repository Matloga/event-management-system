import { ZodError } from 'zod';
import { AppError, translateDbError } from '../utils/errors.js';
import { sendError } from '../utils/http.js';
import env from '../config/env.js';

/** 404 handler for unmatched routes. */
export function notFoundHandler(req, _res, next) {
  next(new AppError(`No route matches ${req.method} ${req.originalUrl}`, 404, 'route_not_found'));
}

/**
 * Terminal error handler. Converts anything thrown anywhere in the app into
 * a safe JSON response. Must be registered last.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(err, req, res, _next) {
  let appError = err;

  if (err instanceof ZodError) {
    appError = new AppError('Some of the submitted values are invalid.', 422, 'validation_error',
      fieldErrors(err));
  } else if (!(err instanceof AppError)) {
    appError = translateDbError(err, `${req.method} ${req.originalUrl}`);
  }

  if (appError.status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  if (res.headersSent) return;

  sendError(res, {
    status: appError.status,
    code: appError.code,
    message: appError.message,
    // Stack traces are a development aid only.
    details: !env.isProduction && appError.status >= 500 ? { stack: err.stack } : appError.details,
  });
}

/** Flatten a ZodError into { field: [messages] }. */
export function fieldErrors(zodError) {
  const out = {};
  for (const issue of zodError.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export default errorHandler;
