/**
 * Seeds demo accounts and events.
 *
 *   npm run seed          # adds demo data (idempotent)
 *   npm run seed -- --fresh   # wipes events and registrations first
 *
 * Passwords are hashed here rather than hard-coded in a .sql file, so the
 * same bcrypt cost applies as in production.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { closePool, connect, query } from '../config/database.js';
import env from '../config/env.js';

const FRESH = process.argv.includes('--fresh');

const PASSWORD = 'Password123';

const USERS = [
  { name: 'Site Administrator', email: 'admin@events.dev', role: 'admin', organisation: 'Event Platform' },
  { name: 'Tech Society', email: 'organizer@events.dev', role: 'organizer', organisation: 'University of Limpopo' },
  { name: 'Limpopo Business Forum', email: 'business@events.dev', role: 'organizer', organisation: 'LBF' },
  { name: 'Thandi Mokoena', email: 'thandi@example.com', role: 'attendee' },
  { name: 'Sipho Ndlovu', email: 'sipho@example.com', role: 'attendee' },
  { name: 'Aisha Patel', email: 'aisha@example.com', role: 'attendee' },
  { name: 'Jonas van Wyk', email: 'jonas@example.com', role: 'attendee' },
];

const day = (offset) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const EVENTS = [
  {
    title: 'React Workshop: Hooks & Performance',
    description:
      'A full-day, hands-on workshop covering useEffect, custom hooks, memoisation, code-splitting and how to profile a slow React app. Bring a laptop with Node 20 installed. Lunch is provided.',
    category: 'technology',
    organizer: 'organizer@events.dev',
    date: day(14),
    startTime: '09:00:00',
    endTime: '16:00:00',
    venue: 'Innovation Hub, Room A1',
    address: 'University Street',
    city: 'Polokwane',
    capacity: 30,
    price: 350,
    featured: true,
    published: true,
  },
  {
    title: 'Polokwane Tech Conference 2026',
    description:
      'Two tracks of talks on software engineering, data and design, plus a hiring hall. Early-bird tickets are limited and the last edition sold out in nine days.',
    category: 'technology',
    organizer: 'organizer@events.dev',
    date: day(45),
    startTime: '08:00:00',
    endTime: '18:00:00',
    venue: 'Polokwane International Convention Centre',
    address: 'R81 old N1 bypass',
    city: 'Polokwane',
    capacity: 400,
    price: 750,
    featured: true,
    published: true,
  },
  {
    title: 'Sunset Jazz on the Terrace',
    description:
      'An evening of smooth jazz from the Kwena Trio, with a tapas menu and a licensed bar. Dress smart, arrive early for a good spot on the terrace.',
    category: 'music',
    organizer: 'business@events.dev',
    date: day(7),
    startTime: '18:00:00',
    endTime: '22:00:00',
    venue: 'Limpopo Lodge Terrace',
    address: '9 Loop Street',
    city: 'Polokwane',
    capacity: 120,
    price: 180,
    published: true,
  },
  {
    title: 'Community Clean-up: Seshego',
    description:
      'Gloves, bags and refreshments supplied. Meet at the taxi rank at 07:00, we will be done by 10:30. All ages welcome, families especially needed.',
    category: 'community',
    organizer: 'business@events.dev',
    date: day(3),
    startTime: '07:00:00',
    endTime: '10:30:00',
    venue: 'Seshego Taxi Rank',
    address: 'Zone 3',
    city: 'Seshego',
    capacity: 80,
    price: 0,
    published: true,
  },
  {
    title: 'Small Business Finance Clinic',
    description:
      'Free one-on-one consultations on cash flow, pricing and funding applications. Book a 20-minute slot when you register; bring three months of statements.',
    category: 'business',
    organizer: 'business@events.dev',
    date: day(21),
    startTime: '13:00:00',
    endTime: '17:00:00',
    venue: 'Limpopo Business Hub',
    address: 'Mariette Street',
    city: 'Polokwane',
    capacity: 2,
    price: 0,
    published: true,
  },
  {
    title: 'Introduction to Data Science',
    description:
      'A beginner course covering Python for data, pandas, and your first predictive model. No prior programming experience required.',
    category: 'education',
    organizer: 'organizer@events.dev',
    date: day(30),
    startTime: '09:00:00',
    endTime: '15:00:00',
    venue: 'Library Lecture Hall B',
    address: 'College Building',
    city: 'Polokwane',
    capacity: 60,
    price: 250,
    published: true,
  },
  {
    title: 'Makhanda Cultural Festival',
    description:
      'Traditional dance, live marimba, craft stalls and storytelling for children. A full day of family programming across three stages.',
    category: 'arts-culture',
    organizer: 'business@events.dev',
    date: day(60),
    startTime: '10:00:00',
    endTime: '20:00:00',
    venue: 'Old Mutual Gardens',
    address: 'Thohoyandou',
    city: 'Thohoyandou',
    capacity: 500,
    price: 0,
    published: true,
  },
  {
    title: 'Internationally Certified First Aid',
    description:
      'A full day course leading to a recognised first-aid certificate. Valid for three years. Includes a written assessment and practical stations.',
    category: 'health-fitness',
    organizer: 'organizer@events.dev',
    date: day(10),
    startTime: '08:00:00',
    endTime: '16:00:00',
    venue: 'Health Sciences Building, Room 12',
    address: 'Turfloop Road',
    city: 'Polokwane',
    capacity: 25,
    price: 550,
    published: true,
  },
  {
    title: 'Startup Pitch Evening (draft)',
    description:
      'Five startups, five minutes each, judges from the local business community. Currently being finalised with the venue.',
    category: 'business',
    organizer: 'organizer@events.dev',
    date: day(38),
    startTime: '18:30:00',
    endTime: '21:00:00',
    venue: 'To be confirmed',
    city: 'Polokwane',
    capacity: 100,
    price: 0,
    published: false,
  },
  {
    title: 'Interprovincial Athletics Trials',
    description:
      'Track and field trials for the 100m, 400m, 800m and long jump. Registration closes two days before the event; bring a valid athlete licence.',
    category: 'sports',
    organizer: 'business@events.dev',
    date: day(-9),
    startTime: '07:00:00',
    endTime: '14:00:00',
    venue: 'Turfloop Stadium',
    address: 'Turfloop Road',
    city: 'Polokwane',
    capacity: 300,
    price: 50,
    published: true,
  },
];

async function wipe() {
  console.log('[seed] clearing events and registrations');
  await query('DELETE FROM dbo.registrations');
  await query('DELETE FROM dbo.reviews');
  await query('DELETE FROM dbo.events');
}

async function seedUsers(passwordHash) {
  const ids = new Map();
  for (const u of USERS) {
    const existing = await query('SELECT id FROM dbo.users WHERE email = @email', { email: u.email });
    if (existing.recordset.length) {
      ids.set(u.email, existing.recordset[0].id);
      continue;
    }
    const res = await query(
      `INSERT INTO dbo.users (id, name, email, password_hash, role, organisation)
       OUTPUT INSERTED.id
       VALUES (@id, @name, @email, @hash, @role, @org)`,
      { id: randomUUID(), name: u.name, email: u.email, hash: passwordHash, role: u.role, org: u.organisation ?? null }
    );
    ids.set(u.email, res.recordset[0].id);
  }
  console.log(`[seed] ${ids.size} users ready`);
  return ids;
}

async function seedEvents(userIds) {
  const categories = await query('SELECT id, slug FROM dbo.categories');
  const bySlug = new Map(categories.recordset.map((c) => [c.slug, c.id]));

  let created = 0;
  for (const e of EVENTS) {
    const existing = await query('SELECT id FROM dbo.events WHERE title = @title', { title: e.title });
    if (existing.recordset.length) continue;

    const categoryId = bySlug.get(e.category);
    if (!categoryId) {
      console.warn(`[seed] skipping "${e.title}": unknown category "${e.category}"`);
      continue;
    }

    await query(
      `INSERT INTO dbo.events
         (id, title, description, category_id, organizer_id, event_date, start_time, end_time,
          venue, address, city, country, latitude, longitude, capacity, price, is_featured, is_published)
       VALUES
         (@id, @title, @description, @categoryId, @organizerId, @date, @startTime, @endTime,
          @venue, @address, @city, 'South Africa', @lat, @lng, @capacity, @price, @featured, @published)`,
      {
        id: randomUUID(),
        title: e.title,
        description: e.description,
        categoryId,
        organizerId: userIds.get(e.organizer),
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        venue: e.venue,
        address: e.address ?? null,
        city: e.city,
        // Rough coordinates so the map widget has something to show.
        lat: -23.9,
        lng: 29.4,
        capacity: e.capacity,
        price: e.price,
        featured: e.featured ? 1 : 0,
        published: e.published ? 1 : 0,
      }
    );
    created += 1;
  }
  console.log(`[seed] ${created} event(s) created`);
}

/** Register a few attendees so the dashboard and waitlist have real numbers. */
async function seedRegistrations(userIds) {
  const event = await query(
    `SELECT TOP 1 id, title, capacity
       FROM dbo.events
      WHERE is_published = 1 AND event_date >= CAST(GETDATE() AS DATE)
      ORDER BY capacity ASC`
  );
  if (!event.recordset.length) return;

  const target = event.recordset[0];
  const attendees = ['thandi@example.com', 'sipho@example.com', 'aisha@example.com', 'jonas@example.com'];

  for (const email of attendees) {
    const userId = userIds.get(email);
    if (!userId) continue;
    const existing = await query(
      `SELECT 1 FROM dbo.registrations
        WHERE event_id = @eventId AND user_id = @userId AND status IN ('confirmed','waitlisted')`,
      { eventId: target.id, userId }
    );
    if (existing.recordset.length) continue;

    // Go through the same stored procedure the API uses, so seeding can
    // never produce a state the application would not allow.
    await query('EXEC dbo.sp_register_for_event @EventId = @e, @UserId = @u, @AllowFull = 0', {
      e: target.id,
      u: userId,
    });
  }
  console.log(`[seed] registrations added to "${target.title}"`);
}

await connect();
if (FRESH) await wipe();

const passwordHash = await bcrypt.hash(PASSWORD, env.BCRYPT_ROUNDS);
const userIds = await seedUsers(passwordHash);
await seedEvents(userIds);
await seedRegistrations(userIds);

console.log('\n[seed] done. Sign in with any of these (password: %s):', PASSWORD);
for (const u of USERS) console.log(`         ${u.role.padEnd(9)} ${u.email}`);

await closePool();
