/**
 * Application error type plus helpers for turning known failures into
 * predictable HTTP responses.
 */
export class AppError extends Error {
  /**
   * @param {string} message  Client-safe message
   * @param {number} status   HTTP status code
   * @param {string} [code]   Stable machine-readable code for the client
   * @param {object} [details] Optional field-level detail
   */
  constructor(message, status = 500, code = 'error', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (msg, code = 'bad_request', details) =>
  new AppError(msg, 400, code, details);
export const unauthorized = (msg = 'Authentication required', code = 'unauthorized') =>
  new AppError(msg, 401, code);
export const forbidden = (msg = 'You do not have permission to do that', code = 'forbidden') =>
  new AppError(msg, 403, code);
export const notFound = (msg = 'Resource not found', code = 'not_found') =>
  new AppError(msg, 404, code);
export const conflict = (msg, code = 'conflict') => new AppError(msg, 409, code);
export const unprocessable = (msg, code = 'unprocessable', details) =>
  new AppError(msg, 422, code, details);

/**
 * Map a SQL Server error number to a client-safe AppError.
 * The raw driver message is never forwarded to the client.
 *
 * @param {unknown} err
 * @param {string} [context]
 */
export function translateDbError(err, context = 'database operation') {
  if (err instanceof AppError) return err;

  const num = err?.number ?? err?.originalError?.number;
  const message = String(err?.message ?? '');

  switch (num) {
    case 2601: // duplicate key
    case 2627:
      return conflict('That value is already in use', 'duplicate');
    case 547: // FK / CHECK constraint violation
      return conflict(
        'That change would break a related record. Check the values and try again.',
        'constraint_violation'
      );
    case 2628: // unique index perms
      return conflict('A conflicting record already exists', 'duplicate');
    case 4060: // cannot open database
      return new AppError('The database is not available. Please try again shortly.', 503, 'db_unavailable');
    default: {
      const code = String(err?.code ?? '');
      const lowered = message.toLowerCase();
      const unreachable =
        code === 'ESOCKET' ||
        code === 'ETIMEOUT' ||
        code === 'ECONNREFUSED' ||
        code === 'ECONNCLOSED' ||
        code === 'ENOTFOUND' ||
        lowered.includes('failed to connect') ||
        lowered.includes('econnrefused') ||
        lowered.includes('etimedout') ||
        lowered.includes('connection is closed') ||
        lowered.includes('the semaphore timeout period has expired') ||
        lowered.includes('login failed for user');
      if (unreachable) {
        return new AppError('The database is not reachable. Please try again shortly.', 503, 'db_unreachable');
      }
      console.error(`[db] unexpected error during ${context}:`, num ?? '-', message);
      return new AppError('Something went wrong on our side. Please try again.', 500, 'internal_error');
    }
  }
}
