import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { fieldErrors } from './errorHandler.js';

/**
 * Validate a request segment against a Zod schema and replace it with the
 * parsed (coerced, stripped) result, so controllers only ever see clean data.
 *
 * @param {'body'|'query'|'params'} source
 * @param {import('zod').ZodTypeAny} schema
 */
export function validate(source, schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        new AppError('Some of the submitted values are invalid.', 422, 'validation_error', {
          source,
          fields: fieldErrors(result.error),
        })
      );
    }
    // Express 5 exposes req.query as a getter, so cache the parsed copy.
    if (source === 'query') {
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    } else {
      req[source] = result.data;
    }
    return next();
  };
}

/** Re-exported so controllers can throw validation failures consistently. */
export { ZodError };
