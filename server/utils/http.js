/**
 * Consistent success envelope: { success: true, data, meta? }
 */
export function sendData(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/** Consistent failure envelope: { success: false, error: { code, message, details? } } */
export function sendError(res, { status = 500, code = 'error', message, details }) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ success: false, error });
}

/** Pagination metadata shape returned alongside list endpoints. */
export function pageMeta({ page, limit, total }) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
