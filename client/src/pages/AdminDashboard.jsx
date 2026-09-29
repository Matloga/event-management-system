import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminStats } from '../hooks/useApi.js';
import { adminService } from '../services/adminService.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, ErrorState, EmptyState } from '../components/Feedback.jsx';
import { formatDate, formatPrice } from '../utils/format.js';

const RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

const ROLES = [
  { value: '', label: 'All roles' },
  { value: 'attendee', label: 'Attendees' },
  { value: 'organizer', label: 'Organisers' },
  { value: 'admin', label: 'Admins' },
];

/** Platform-wide administration: analytics, users and featured events. */
export default function AdminDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [days, setDays] = useState(30);
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const stats = useAdminStats(days);

  const users = useQuery({
    queryKey: ['admin', 'users', { role, search, page }],
    queryFn: () => adminService.users({ role, search, page, limit: 25 }),
  });

  const events = useQuery({
    queryKey: ['admin', 'events'],
    queryFn: () => adminService.events({ limit: 12, sort: 'newest', scope: 'all' }),
  });

  const setRoleMutation = useMutation({
    mutationFn: ({ userId, nextRole }) => adminService.setRole(userId, nextRole),
    onSuccess: ({ data }) => {
      toast.success(`${data.user.name} is now an ${data.user.role}.`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const featureMutation = useMutation({
    mutationFn: ({ eventId, isFeatured }) => adminService.feature(eventId, isFeatured),
    onSuccess: (_, { isFeatured }) => {
      toast.success(isFeatured ? 'Event featured.' : 'Feature removed.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'events'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const exportAll = async () => {
    setExporting(true);
    try {
      await adminService.exportRegistrations();
      toast.success('Registrations exported.');
    } catch (err) {
      toast.error(err.message || 'The export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="container stack stack-8">
      <header className="row between wrap row-4">
        <div className="stack stack-2">
          <h1>Admin console</h1>
          <p className="muted">Platform analytics, user roles and featured content.</p>
        </div>
        <div className="row wrap row-2">
          <button type="button" className="btn btn-outline btn-sm" onClick={exportAll} disabled={exporting}>
            {exporting ? 'Exporting' : 'Export all registrations'}
          </button>
          <Link to="/check-in" className="btn btn-outline btn-sm">
            Check-in scanner
          </Link>
        </div>
      </header>

      {stats.isError ? (
        <ErrorState error={stats.error} onRetry={stats.refetch} />
      ) : stats.isPending ? (
        <Spinner label="Loading platform analytics" />
      ) : (
        <>
          <div className="row between wrap row-3">
            <h2>Platform overview</h2>
            <div className="row wrap row-2">
              {RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  className={`chip ${days === range.value ? 'active' : ''}`}
                  onClick={() => setDays(range.value)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>

          <section className="stat-grid">
            <StatBox
              label="Events"
              value={stats.data.platform.events.total}
              hint={`${stats.data.platform.events.published} published, ${stats.data.platform.events.drafts} drafts`}
            />
            <StatBox
              label="Registrations"
              value={stats.data.platform.registrations.confirmed}
              hint={`${stats.data.platform.registrations.waitlisted} waitlisted, ${stats.data.platform.registrations.cancelled} cancelled`}
            />
            <StatBox label="Check-ins" value={stats.data.platform.registrations.checkins} />
            <StatBox label="Ticket revenue" value={formatPrice(stats.data.platform.ticketRevenue)} />
            <StatBox label="Average rating" value={stats.data.platform.averageRating.toFixed(2)} />
            <StatBox
              label="Users"
              value={stats.data.users.total}
              hint={`${stats.data.users.organizers} organisers, ${stats.data.users.admins} admins`}
            />
          </section>

          <div className="grid-2">
            <ActivityChart trend={stats.data.trend} />
            <CategoryBreakdown categories={stats.data.categories} />
          </div>

          {stats.data.cities.length > 0 && (
            <section className="card stack stack-3">
              <h2 className="card-title">Cities with the most upcoming events</h2>
              <div className="row wrap row-2">
                {stats.data.cities.map((city) => (
                  <span key={`${city.city}-${city.country}`} className="badge badge-info">
                    {city.city} &middot; {city.events}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="card stack stack-3">
            <h2 className="card-title">Busiest events</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th className="num">Booked</th>
                    <th className="num">Waitlist</th>
                    <th className="num">Fill rate</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.data.topEvents.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Link to={`/events/${event.id}`}>{event.title}</Link>
                      </td>
                      <td className="num">
                        {event.confirmed} / {event.capacity}
                      </td>
                      <td className="num">{event.waitlisted}</td>
                      <td className="num">{event.fillRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="stack stack-4">
        <h2>Users</h2>

        <div className="card row wrap row-3">
          <div className="field grow" style={{ minWidth: 200 }}>
            <label className="label" htmlFor="user-search">
              Search
            </label>
            <input
              id="user-search"
              className="input"
              type="search"
              placeholder="Name or email"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="field" style={{ minWidth: 160 }}>
            <label className="label" htmlFor="role-filter">
              Role
            </label>
            <select
              id="role-filter"
              className="select"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              {ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {users.isPending ? (
          <Spinner label="Loading users" />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={users.refetch} />
        ) : users.data.length === 0 ? (
          <EmptyState title="No users match">Try a different search or role filter.</EmptyState>
        ) : (
          <>
            <div className="table-wrap card card-flush">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th className="num">Change role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.map((row) => (
                    <tr key={row.id}>
                      <td className="bold">{row.name}</td>
                      <td className="small muted">{row.email}</td>
                      <td>
                        <span className="badge badge-brand">{row.role}</span>
                      </td>
                      <td className="small muted">{formatDate(row.createdAt)}</td>
                      <td className="num">
                        <select
                          className="select"
                          style={{ width: 'auto' }}
                          value={row.role}
                          disabled={row.id === user.id || setRoleMutation.isPending}
                          aria-label={`Change role for ${row.name}`}
                          onChange={(e) =>
                            setRoleMutation.mutate({ userId: row.id, nextRole: e.target.value })
                          }
                        >
                          <option value="attendee">Attendee</option>
                          <option value="organizer">Organiser</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {users.meta?.pages > 1 && (
              <div className="row center row-3">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span className="small muted">
                  Page {page} of {users.meta.pages}
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={page >= users.meta.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="stack stack-4">
        <h2>Recently created events</h2>
        {events.isPending ? (
          <Spinner label="Loading events" />
        ) : events.isError ? (
          <ErrorState error={events.error} onRetry={events.refetch} />
        ) : (
          <div className="table-wrap card card-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Organiser</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="num">Featured</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Link to={`/events/${event.id}`}>{event.title}</Link>
                    </td>
                    <td className="small muted">{event.organizer.name}</td>
                    <td className="small">{formatDate(event.date)}</td>
                    <td>
                      <span className={`badge ${event.isPublished ? 'badge-success' : 'badge-warning'}`}>
                        {event.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td className="num">
                      <label className="checkbox" style={{ justifyContent: 'flex-end' }}>
                        <input
                          type="checkbox"
                          checked={event.isFeatured}
                          disabled={featureMutation.isPending}
                          onChange={(e) =>
                            featureMutation.mutate({ eventId: event.id, isFeatured: e.target.checked })
                          }
                        />
                        <span className="sr-only">Feature {event.title}</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Sign-ups vs registrations, drawn as a two-series inline bar chart. */
function ActivityChart({ trend }) {
  const max = Math.max(1, ...trend.map((point) => Math.max(point.signups, point.registrations)));

  return (
    <section className="card stack stack-3">
      <h2 className="card-title">Activity, last {trend.length} days</h2>

      {trend.every((point) => point.signups === 0 && point.registrations === 0) ? (
        <p className="muted small">No sign-ups or registrations in this period.</p>
      ) : (
        <>
          <div
            className="row align-end row-2"
            style={{ height: 120, gap: 4 }}
            role="img"
            aria-label={`Daily sign-ups and registrations over ${trend.length} days`}
          >
            {trend.map((point) => (
              <div
                key={point.date}
                className="grow"
                style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'flex-end' }}
                title={`${point.date}: ${point.signups} sign-ups, ${point.registrations} registrations`}
              >
                <div
                  style={{
                    height: `${(point.registrations / max) * 100}%`,
                    background: 'var(--brand-600)',
                    borderRadius: 2,
                    minHeight: point.registrations > 0 ? 2 : 0,
                  }}
                />
                <div
                  style={{
                    height: `${(point.signups / max) * 100}%`,
                    background: 'var(--brand-200)',
                    borderRadius: 2,
                    minHeight: point.signups > 0 ? 2 : 0,
                  }}
                />
              </div>
            ))}
          </div>

          <div className="row row-4 tiny muted">
            <span className="row row-2">
              <span
                aria-hidden="true"
                style={{ width: 10, height: 10, background: 'var(--brand-600)', borderRadius: 2 }}
              />
              Registrations
            </span>
            <span className="row row-2">
              <span
                aria-hidden="true"
                style={{ width: 10, height: 10, background: 'var(--brand-200)', borderRadius: 2 }}
              />
              Sign-ups
            </span>
            <span className="muted">{trend[0]?.date} to {trend[trend.length - 1]?.date}</span>
          </div>
        </>
      )}
    </section>
  );
}

function CategoryBreakdown({ categories }) {
  const max = Math.max(1, ...categories.map((c) => c.registrations));

  return (
    <section className="card stack stack-3">
      <h2 className="card-title">Bookings by category</h2>

      {categories.length === 0 ? (
        <p className="muted small">No categories configured.</p>
      ) : (
        categories.map((entry) => (
          <div key={entry.slug} className="stack stack-1">
            <div className="row between small">
              <span className="row row-2">
                <span
                  aria-hidden="true"
                  style={{ width: 8, height: 8, borderRadius: '50%', background: entry.accent }}
                />
                {entry.category}
                <span className="muted">({entry.events} events)</span>
              </span>
              <span className="muted">{entry.registrations}</span>
            </div>
            <div className="meter">
              <div
                className="meter-fill"
                style={{ width: `${(entry.registrations / max) * 100}%`, background: entry.accent }}
              />
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function StatBox({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
