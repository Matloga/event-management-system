# Event Management System

A full-stack event platform: attendees discover and book events, organisers publish
listings and manage registrations, and admins run the platform. Tickets are issued
as QR codes and redeemed with a door scanner.

Built as a portfolio-grade reference project: every layer is separated, every
request is validated, and the registration path is protected by SQL stored
procedures rather than application-level checks.

- **Backend** — Node.js, Express 5, SQL Server (`mssql`), JWT, Zod
- **Frontend** — React 19, React Router 7, TanStack Query, Vite 8, plain CSS
- **Database** — Microsoft SQL Server 2019+ or Azure SQL

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Database](#database)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Design decisions](#design-decisions)
- [Troubleshooting](#troubleshooting)

---

## Features

### For attendees

- Browse, search and filter events by keyword, category, city, date range and price
- Eight sort orders (date, popularity, seats left, price, rating, newest)
- Single-request landing page with featured, upcoming and trending rails
- Register for an event, or join the waitlist when it is full
- QR ticket per registration, shown in the browser and emailed as SVG/PNG
- Cancel a registration; the seat is offered to the waitlist automatically
- Rate and review events you attended
- Upcoming / past ticket history, searchable

### For organisers

- Create, edit, publish/unpublish and delete events
- Capacity, price, cover image, coordinates and category
- Dashboard with registrations, waitlist, check-ins and average fill rate
- Attendee list with search and status filters
- One-click CSV export of the attendee list
- Door check-in: scan a ticket, or type a token, with idempotent results

### For admins

- Platform analytics: events, registrations, check-ins, revenue, average rating
- Sign-up and registration activity chart over 7/30/90 days
- Bookings broken down by category and by city
- User management with role changes (attendee / organiser / admin)
- Feature any event onto the landing page
- Export every registration on the platform

### Cross-cutting

- JWT auth with bcrypt password hashing and a live password policy
- Role-based authorisation on every mutating route
- Zod validation on all input, with per-field error messages returned to the client
- Rate limiting (tighter on auth), Helmet security headers, CORS allow-list
- Consistent `{ success, data, meta }` / `{ success, error }` response envelope
- Responsive UI down to 360px, keyboard navigable, `prefers-reduced-motion` respected

---

## Architecture

```
Browser
   │  /api/*  (proxied in dev, direct in production)
   ▼
Express 5 ── middleware ── validators ── controllers ── models ── SQL Server
                 │                          │            │            │
            rate limit, auth          services        mappers     stored
            helmet, CORS              mail, qr, csv                 procedures
```

**Request flow.** Every route runs through the same chain:

1. `helmet` + `cors` + `rateLimit` — global middleware
2. `requireAuth` / `requireOrganizer` / `requireAdmin` — role guards
3. `validate('body' | 'query' | 'params', schema)` — Zod, replaces the segment
   with the parsed result so controllers only see clean, coerced data
4. `asyncHandler(controller)` — forwards rejected promises to the error handler
5. Controller → model → `query()` (pooled) or a stored procedure
6. `sendData(res, data, { meta })` → JSON envelope

**Response shape.** Success and failure are always the same shape, so the client
never has to guess:

```jsonc
// success
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 12, "total": 48, "pages": 4 } }

// failure
{ "success": false, "error": { "code": "invalid_filter", "message": "…", "details": { "fields": { } } } }
```

**Error codes** map to status codes centrally in `middleware/errorHandler.js`, so
a database outage becomes `503` and an unknown route becomes `404` — never a
leaked stack trace.

---

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | 20+ (built on 25.2.1) | ESM only, `"type": "module"` |
| SQL Server | 2019+ or Azure SQL | Local, Docker, or a cloud instance |
| npm | 10+ | Ships with Node |

You need **some** SQL Server. Options:

- SQL Server Express / Developer Edition installed locally
- Docker: `docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourStrong!Passw0rd" -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest`
- Azure SQL (free tier) or any hosted instance

---

## Getting started

### 1. Install

```bash
# API
cd server && npm install

# Client
cd ../client && npm install
```

### 2. Configure the API

```bash
cd server
cp .env.example .env
```

Edit `server/.env` and set at least:

```dotenv
DB_SERVER=localhost
DB_USER=sa
DB_PASSWORD=YourStrong!Passw0rd
DB_TRUST_CERT=true
JWT_SECRET=<a long random string>
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Create the database

`db:reset` drops and recreates everything, applies the schema, creates the stored
procedures and seeds the category reference data:

```bash
cd server
npm run db:reset
npm run db:verify     # confirms every table, procedure and category is present
```

Prefer to keep existing data? Apply the scripts individually:

```bash
npm run db:schema
npm run db:procedures
npm run db:categories
```

The scripts are idempotent, so re-running `db:procedures` is also how you pick up
edits to a stored procedure — `CREATE OR ALTER` replaces the definition in place
without touching data. Do that after editing anything in `sql/002_procedures.sql`,
or the running API will keep calling the old version.

### 4. Seed demo data (optional)

```bash
npm run seed
```

Creates a demo admin, organiser and several attendees with published events,
registrations, waitlist entries and reviews. It is idempotent — running it twice
does not duplicate anything. The generated passwords are printed once.

### 5. Run both apps

```bash
# terminal 1
cd server && npm run dev      # http://localhost:5000

# terminal 2
cd client && npm run dev      # http://localhost:5173
```

Open **http://localhost:5173**. Vite proxies `/api` to port 5000, so there are no
CORS preflights in development.

> The first account you register through the UI automatically becomes the
> platform **admin**; every later account starts as an attendee. Promote others
> from the admin console.

### 6. Build for production

```bash
cd client && npm run build    # -> client/dist
cd ../server && npm start
```

Serve `client/dist` from any static host (Netlify, Vercel, nginx). Set
`VITE_API_URL` to the public API origin at build time and `PUBLIC_CLIENT_URL` on
the API, so ticket QR codes resolve to the deployed app.

**Configure SPA fallback.** Ticket QR codes deep-link to `/check-in`, so every
unknown path must return `index.html` rather than a 404 — otherwise an attendee
scanning at the door gets "not found". Netlify (`/* /index.html 200`) and Vercel
do this automatically; for nginx:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

With nginx, `/api/` must be proxied to the API before this block, otherwise the
fallback swallows API calls too.

---

## Environment variables

### `server/.env`

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `5000` | API port |
| `CLIENT_URL` | no | `http://localhost:5173` | Comma-separated CORS allow-list; first entry is the canonical app origin |
| `PUBLIC_CLIENT_URL` | no | first `CLIENT_URL` entry | Origin encoded into ticket QR codes — a camera opens this, so it must be the SPA, not the API |
| `DB_SERVER` | **yes** | — | `localhost` or `my-server.database.windows.net` |
| `DB_PORT` | no | `1433` | |
| `DB_NAME` | **yes** | — | Application database |
| `DB_USER` | **yes** | — | |
| `DB_PASSWORD` | no | `''` | |
| `DB_ENCRYPT` | no | `true` | Keep `true` for Azure SQL |
| `DB_TRUST_CERT` | no | `false` | `true` for self-signed local certs |
| `DB_POOL_MAX` | no | `10` | Pool size |
| `DB_CONNECT_TIMEOUT_MS` | no | `15000` | |
| `DB_TEST_NAME` | no | — | Separate database for `npm test` |
| `JWT_SECRET` | **yes** | — | ≥ 16 characters |
| `JWT_EXPIRES_IN` | no | `7d` | |
| `BCRYPT_ROUNDS` | no | `12` | 8–15 |
| `MAIL_DRIVER` | no | `console` | `console` \| `json` \| `smtp` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` | no | — | Used when `MAIL_DRIVER=smtp` |
| `MAIL_FROM` `MAIL_FROM_NAME` | no | | Sender identity |

Configuration is validated once at boot with Zod. A missing or malformed value
fails immediately with a readable list of problems rather than a confusing error
on the first request.

### `client/.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `/api` | API base URL. Leave as-is behind the dev proxy. |
| `VITE_PROXY_TARGET` | `http://localhost:5000` | Dev-only proxy target. |

---

## API reference

All routes are prefixed with `/api`. `Authorization: Bearer <token>` is required
except where marked public.

### Auth — `/api/auth`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/register` | public | Create an account; returns a token |
| `POST` | `/login` | public | Exchange credentials for a token |
| `POST` | `/logout` | authed | Stateless; records intent |
| `GET` | `/me` | authed | Current user |
| `PATCH` | `/profile` | authed | Update name, organisation, phone, bio |
| `POST` | `/password` | authed | Change password |
| `PATCH` | `/admin/users/:id/role` | admin | Change a user's role |

### Events — `/api/events`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/` | public | List with `search`, `category`, `city`, `scope`, `pricing`, `from`, `to`, `sort`, `page`, `limit` |
| `GET` | `/home` | public | Featured + upcoming + popular + cities in one call |
| `GET` | `/mine` | authed | Your own events, drafts included |
| `GET` | `/:id` | public | Detail with reviews, rating summary and stats |
| `POST` | `/` | organiser | Create |
| `PATCH` | `/:id` | owner/admin | Update (capacity cannot drop below bookings) |
| `PATCH` | `/:id/publish` | owner/admin | Publish or unpublish |
| `PATCH` | `/:id/feature` | admin | Feature on the landing page |
| `DELETE` | `/:id` | owner/admin | Delete with all registrations |
| `POST` | `/:id/register` | authed | Register, or join the waitlist with `{ waitlist: true }` |
| `DELETE` | `/:id/register` | authed | Cancel and promote the waitlist |
| `GET` | `/:id/attendees` | owner/admin | Attendee list with `status`, `search`, paging |
| `GET` | `/:id/attendees.csv` | owner/admin | CSV export (ignores paging) |
| `GET` | `/:id/reviews` | public | Reviews |
| `POST` | `/:id/reviews` | attendee | Rate a confirmed event |

### Registrations — `/api/registrations`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/mine?scope=upcoming\|past\|all` | authed | Your tickets |
| `GET` | `/mine/:eventId` | authed | One ticket, including its QR token |
| `GET` | `/mine/:eventId/qr.svg` | authed | Server-rendered QR code |
| `POST` | `/check-in` | organiser | Redeem a scanned token |
| `DELETE` | `/:eventId` | authed | Cancel your registration |

### Dashboard and admin — `/api`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/health` | public | Liveness, uptime, database reachability |
| `GET` | `/categories` | public | Category reference data with counts |
| `GET` | `/dashboard` | authed | Role-aware summary for the signed-in user |
| `GET` | `/admin/stats` | admin | Platform analytics, trend, categories, cities |
| `GET` | `/admin/users` | admin | User list with `search`, `role`, paging |
| `GET` | `/admin/events` | admin | Every event, drafts included |
| `GET` | `/admin/registrations.csv` | admin | Export all registrations |
| `DELETE` | `/admin/reviews/:id` | admin | Moderate a review |

### `GET /api/health`

```jsonc
{
  "success": true,
  "data": {
    "status": "healthy",     // or "degraded" when the database is unreachable
    "uptimeSeconds": 412,
    "database": { "ok": true, "latencyMs": 3 },
    "latencyMs": 5
  }
}
```

---

## Database

### Schema

```
users ──────┬──< registrations >──┬── events >── categories
            │                     │
            └──< reviews >────────┘
```

| Table | Purpose |
| --- | --- |
| `users` | Accounts, bcrypt hash, role, profile fields |
| `categories` | Reference data with an accent colour for the UI |
| `events` | Listing, capacity, price, publication and feature flags, GPS |
| `registrations` | One row per user per event: status, ticket number, QR token, check-in stamp |
| `reviews` | 1–5 rating plus an optional comment, unique per user per event |

Key constraints:

- A filtered unique index prevents a second active registration for the same
  user and event, without preventing a re-registration after cancellation
- `qr_token` is unique, so a ticket can never resolve to two registrations
- `capacity ≥ 1`, `price ≥ 0`, `rating BETWEEN 1 AND 5`
- One review per user per event
- `event_date` is a `DATE`, times are `TIME(0)` — no timezone ambiguity

### Stored procedures

Registration and cancellation are the only places where concurrency actually
matters, so they live in the database rather than in JavaScript.

**`sp_register_for_event`** takes `UPDLOCK, HOLDLOCK` on the event row, then:

1. Rejects unpublished or unknown events
2. Rejects a duplicate active registration
3. Confirms the seat when `confirmed < capacity`
4. Otherwise waitlists, when the caller opted in — ordered by `registered_at`
5. Returns a result code the controller maps to an HTTP status

Two simultaneous requests for the last seat cannot both succeed: the second one
blocks on the lock and then sees the updated count.

**`sp_cancel_registration`** releases the seat and promotes the first waitlisted
attendee atomically, returning the promoted ticket number so the API can send
them an email in the same request.

**`sp_check_in_ticket`** is idempotent and now runs under an update lock, so two
scanners racing on the same token serialise — only one reports `ok`, the other
`already`. It also returns `event_id`, which the controller re-checks against the
event it authorised.

### The door check-in flow

`POST /api/registrations/check-in` is guarded by `requireOrganizer`, and the
order of its steps is the security property:

1. **Parse** the input. A bare token, a full ticket link, or a link pasted from
   an attendee's email all reduce to the same opaque token.
2. **Resolve** it to a registration with a plain read — no lock, no write.
3. **Authorise** the scanner against the event that registration actually belongs
   to, never the `eventId` the client sent. A claimed event is only used for a
   friendly "wrong event" message.
4. **Redeem**, passing the *authorised* event id to the procedure so it re-checks
   the token against it in the same transaction that writes `checked_in_at`.

Authorisation therefore happens strictly before any mutation. An organiser
scanning at another organiser's event gets a `403` and nobody is marked in.
A registration's token and event are written once on insert and never change, so
the two statements cannot disagree about which event is being touched.

---

## Testing

```bash
cd server
npm test              # everything; integration tests skip without a database
npm run test:unit     # 104 pure tests, no database needed
npm run test:integration
npm run smoke         # 16 HTTP checks against a live server
```

- **Unit tests** cover validators, mappers, token handling, CSV generation, QR
  payload construction and scanner input parsing, the shared event filter builder
  and error mapping.
- **Integration tests** run the full HTTP surface against a real database,
  including registration, waitlist promotion, QR check-in, CSV export and role
  authorisation. They target `DB_TEST_NAME` and **skip cleanly** when no server
  is reachable, so a fresh clone still gets a green run.
- **Smoke tests** verify the app boots, returns the right status codes for
  validation and auth failures, and emits security headers.

```bash
# Run the integration suite for real
$env:DB_TEST_NAME = "event_management_test"
npm run test:integration
```

---

## Project layout

```
.
├── README.md
├── .gitignore
│
├── server/
│   ├── app.js                  # Express app factory
│   ├── server.js               # Startup, DB check, graceful shutdown
│   ├── config/
│   │   ├── database.js         # mssql pool, query(), transaction()
│   │   └── env.js              # Zod-validated configuration
│   ├── controllers/            # HTTP layer
│   │   ├── authController.js
│   │   ├── eventController.js
│   │   ├── registrationController.js
│   │   ├── reviewController.js
│   │   ├── categoryController.js
│   │   └── adminController.js
│   ├── middleware/
│   │   ├── auth.js             # requireAuth / requireOrganizer / requireAdmin
│   │   ├── errorHandler.js     # AppError -> HTTP, SQL error translation
│   │   ├── rateLimit.js
│   │   └── validate.js         # Zod request validation
│   ├── models/                 # SQL and row mapping, no HTTP concerns
│   │   ├── userModel.js
│   │   ├── eventModel.js
│   │   ├── registrationModel.js
│   │   ├── reviewModel.js
│   │   ├── categoryModel.js
│   │   └── mappers.js          # SQL Server type normalisation
│   ├── routes/                 # Middleware chains
│   ├── services/
│   │   ├── tokenService.js     # JWT sign/verify
│   │   ├── mailService.js      # confirmation, cancellation, waitlist
│   │   ├── qrService.js        # payload construction, SVG/PNG rendering
│   │   ├── csvService.js       # attendee exports
│   │   └── statsService.js     # dashboard aggregates
│   ├── validators/             # Zod schemas per resource
│           ├── utils/                  # asyncHandler, errors, http helpers
│   ├── sql/
│   │   ├── 001_schema.sql      # Tables, indexes, constraints
│   │   ├── 002_procedures.sql  # Registration, cancellation, check-in
│   │   └── 003_seed_categories.sql
│   ├── scripts/
│   │   ├── run-sql.js          # Batch splitter + database bootstrap
│   │   ├── check-db.js         # db:verify
│   │   ├── seed.js             # Demo data
│   │   ├── send-reminders.js   # Upcoming-event reminder emails
│   │   └── smoke.js
│   └── tests/
│       ├── setup.js
│       ├── unit/
│       └── integration/
│
└── client/
    ├── vite.config.js
    ├── eslint.config.js
    ├── index.html
    └── src/
        ├── main.jsx            # Providers + router mount
        ├── App.jsx             # Route table
        ├── components/         # Header, Footer, EventCard, Modal, Feedback
        ├── context/            # AuthContext, ToastContext
        ├── hooks/useApi.js     # TanStack Query hooks
        ├── pages/              # One file per screen
        ├── services/           # api.js + per-resource service objects
        ├── styles/index.css    # Design tokens and all component styles
        └── utils/              # format.js (dates, price) + ticket.js (scanner input)
```

---

## Design decisions

**Stored procedures for registration.** Booking is the one operation where two
people racing for the last seat must not both win. Doing it in SQL under a row
lock makes that a property of the database rather than of a code path, and it
survives multiple API instances without extra coordination.

**Validation at the edge.** Every request segment is parsed by Zod and the parsed
result *replaces* the raw input. Controllers therefore never coerce, validate or
branch on `undefined`, and defaults can never silently overwrite stored data on
update.

**Uniform response envelope.** One success shape and one error shape means the
Axios layer can unwrap responses and normalise failures into a single `ApiError`
class, so no component ever touches Axios internals or guesses at an error body.

**SQL-driven filters with a whitelist.** Search, sort and filters are built from
a shared function. Sort keys map through a fixed table, so user input can never
reach `ORDER BY`, and no dynamic SQL is ever assembled from raw request values.

**QR codes encode an opaque token.** The code carries a random token resolved
server-side — never a registration id and never anything guessable. A leaked
photo of a ticket reveals nothing on its own.

**The QR link opens the scanner, not the API.** An attendee's phone camera is
what follows that link, and a camera can only issue a `GET`. The payload
therefore points at the SPA's `/check-in` route, where the token is read and
redeemed with an authenticated `POST`; pointing it at the POST-only API endpoint
would have left every attendee staring at a `404` at the door. `PUBLIC_CLIENT_URL`
exists for exactly this reason, and a client served from a sub-path keeps that
prefix.

**Fire-and-forget mail.** A mail outage must not undo a successful booking, so
sending is deliberately not awaited on the registration path. Cancellation is the
exception: waitlist promotion email depends on data the request just wrote.

**Filter state in the URL.** Every filter on the browse page is a query
parameter, so a search is shareable, bookmarkable and the back button behaves the
way people expect.

**Graceful degradation without a database.** Integration tests skip rather than
fail when SQL Server is unreachable, and `/api/health` reports `degraded` instead
of refusing to start. A new contributor can clone and run the suite immediately.

**Frontend data fetching.** TanStack Query owns the cache. Filter state lives in
the URL, server state lives in the cache, and mutations invalidate precisely the
queries they affect — so a booking updates the ticket list, the event page and the
dashboard at once.

---

## Troubleshooting

**`Cannot reach the server. Is the backend running?`**
The client cannot reach the API. Confirm the server is up on port 5000
(`GET /api/health`) and that `VITE_PROXY_TARGET` points at it.

**`SQL Server not reachable at localhost:1433`**
The API starts but the pool cannot connect. Check the SQL Server service is
running, that `DB_USER` / `DB_PASSWORD` are correct, and that TCP/IP and the
browser protocol are enabled. On a local instance with a self-signed certificate
set `DB_TRUST_CERT=true`.

**`Invalid environment configuration`**
One or more required variables are missing or malformed. The error lists each one
by name. Start from `.env.example`.

**`Login tables for this app not yet created`**
The database exists but the schema does not. Run `npm run db:reset`, then
`npm run db:verify`.

**Duplicate-key error on `registrations`**
Expected during a race — the unique index blocked a double booking. The stored
procedure normally prevents this; seeing it means a row was inserted outside the
API.

**`Capacity cannot drop below the N seats already booked`**
Intended. The API refuses to strand people who already hold a seat.

**Emails are not arriving**
`MAIL_DRIVER=console` prints a one-line summary and `json` prints the full
message to stdout — both are fine for development. Set `MAIL_DRIVER=smtp` with
real credentials to deliver mail. Check the server log for the confirmation.

**Scanning a ticket gives a 404**
The QR link points at the SPA's `/check-in`, so the static host needs an SPA
fallback (see [Getting started](#getting-started)). If you changed `CHECKIN_PATH`
or the base URL, confirm the payload still points at a route the client serves.

**Integration tests are skipped**
Expected without a database. Set `DB_TEST_NAME` and make sure that database is
reachable, then run `npm run test:integration`.
