/**
 * Row -> API object mappers.
 *
 * SQL Server `DATE` and `TIME` columns are returned by the driver as JS Date
 * objects, which introduces timezone ambiguity. All list/detail queries
 * therefore CONVERT these columns to strings in SQL (style 23 => 'YYYY-MM-DD',
 * style 108 => 'HH:MM:SS'); these helpers keep that guarantee in one place.
 */

/** Pass-through ISO timestamp string, e.g. '2026-07-01T09:15:00.000Z'. */
export const isoDate = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

/** 'YYYY-MM-DD' straight from a CONVERT(...,, 23) column. */
export const ymd = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v);
};

/** 'HH:MM' from a CONVERT(...,, 108) column. */
export const hm = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(v.getHours())}:${p(v.getMinutes())}`;
  }
  return String(v);
};

/** SQL Server BIT -> boolean. */
export const bool = (v) => v === true || v === 1;

/** decimal/number -> JS number, or null. */
export const num = (v) => (v == null ? null : Number(v));

/** Uppercase role/status enums come back lower-cased for consistency. */
export const lower = (v) => (v == null ? null : String(v).toLowerCase());
