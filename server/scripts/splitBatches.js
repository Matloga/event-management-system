/**
 * Splits a .sql script into batches on `GO` and executes them in order.
 *
 * `GO` is a SQL Server Management Studio batch separator, not T-SQL, so it
 * has to be handled client-side.
 */

export function splitBatches(sqlText) {
  const batches = [];
  let current = '';

  for (const rawLine of sqlText.split(/\r?\n/)) {
    // A line that is only whitespace plus GO ends the current batch.
    if (/^\s*GO(\s+\d+)?\s*$/i.test(rawLine)) {
      if (current.trim()) batches.push(current.trim());
      current = '';
    } else {
      current += `${rawLine}\n`;
    }
  }
  if (current.trim()) batches.push(current.trim());
  return batches;
}
