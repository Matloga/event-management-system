import { query } from '../config/database.js';

function toCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    accent: row.accent,
    eventCount: row.event_count != null ? Number(row.event_count) : undefined,
  };
}

export async function listCategories({ withCounts = true } = {}) {
  const result = await query(`
    SELECT c.id, c.name, c.slug, c.description, c.accent,
           ${withCounts
             ? `(SELECT COUNT_BIG(*) FROM dbo.events e
                  WHERE e.category_id = c.id AND e.is_published = 1)`
             : 'NULL'} AS event_count
      FROM dbo.categories c
     ORDER BY c.name ASC
  `);
  return result.recordset.map(toCategory);
}

export async function findCategoryById(id) {
  const result = await query(
    `SELECT id, name, slug, description, accent FROM dbo.categories WHERE id = @id`,
    { id }
  );
  return toCategory(result.recordset[0]);
}

export async function findCategoryBySlug(slug) {
  const result = await query(
    `SELECT id, name, slug, description, accent FROM dbo.categories WHERE slug = @slug`,
    { slug }
  );
  return toCategory(result.recordset[0]);
}
