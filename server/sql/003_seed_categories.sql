/* =====================================================================
   Static reference data: event categories.
   User accounts and demo events are seeded by `npm run seed`
   (see scripts/seed.js) because passwords must be bcrypt-hashed.
   ===================================================================== */

SET NOCOUNT ON;
GO

MERGE dbo.categories AS target
USING (VALUES
    ('Technology',    'technology',    'Conferences, workshops and hackathons',                 '#4f46e5'),
    ('Music',         'music',         'Concerts, festivals and live performances',             '#db2777'),
    ('Business',      'business',      'Networking, summits and corporate meetings',           '#0891b2'),
    ('Education',     'education',     'Courses, seminars and academic events',                 '#ca8a04'),
    ('Health & Fitness','health-fitness','Sport, wellness and community fitness',              '#16a34a'),
    ('Arts & Culture','arts-culture',  'Exhibitions, theatre, film and cultural showcases',     '#ea580c'),
    ('Community',     'community',     'Charity drives, meetups and local gatherings',          '#7c3aed'),
    ('Sports',        'sports',        'Tournaments, races and live sport',                     '#0d9488')
) AS source (name, slug, description, accent)
    ON target.slug = source.slug
WHEN MATCHED THEN
    UPDATE SET target.name = source.name,
               target.description = source.description,
               target.accent = source.accent
WHEN NOT MATCHED THEN
    INSERT (id, name, slug, description, accent)
    VALUES (NEWID(), source.name, source.slug, source.description, source.accent);

PRINT 'Categories seeded.';
GO
