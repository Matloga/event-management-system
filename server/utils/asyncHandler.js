/**
 * Wraps an async route handler so rejected promises reach Express's error
 * middleware instead of hanging the request.
 *
 * @param {(req, res, next) => Promise<unknown>} fn
 * @returns {(req, res, next) => void}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
