import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboard, useMyEvents } from '../hooks/useApi.js';
import { eventService } from '../services/eventService.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, ErrorState, EmptyState, SkeletonGrid } from '../components/Feedback.jsx';
import { formatDate, formatPrice } from '../utils/format.js';

const SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

export default function Dashboard() {
  const { user, isOrganizer, isAdmin } = useAuth();
  const { data, isPending, isError, error, refetch } = useDashboard();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get('scope') ?? 'all';
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  const eventsQuery = useMyEvents(isOrganizer ? { scope, limit: 50 } : null);

  const togglePublish = async (event) => {
    setBusyId(event.id);
    try {
      await eventService.publish(event.id, !event.isPublished);
      toast.success(event.isPublished ? 'Event unpublished.' : 'Event published.');
      queryClient.invalidateQueries({ queryKey: ['events', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container stack stack-8">
      <header className="row between wrap row-4">
        <div className="stack stack-2">
          <h1>Hello, {user.name.split(' ')[0]}</h1>
          <p className="muted">
            Signed in as <span className="badge badge-brand">{user.role}</span>
          </p>
        </div>
        {isOrganizer && (
          <Link to="/events/new" className="btn">
            Create event
          </Link>
        )}
      </header>

      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isPending ? (
        <Spinner label="Loading your dashboard" />
      ) : data.role === 'attendee' ? (
        <AttendeeDashboard tickets={data.tickets} recommended={data.recommended} />
      ) : (
        <OrganizerDashboard
          data={data}
          eventsQuery={eventsQuery}
          scope={scope}
          setScope={(value) => setSearchParams(value === 'all' ? {} : { scope: value }, { replace: true })}
          onTogglePublish={togglePublish}
          busyId={busyId}
        />
      )}

      {isAdmin && (
        <section className="panel row between wrap row-4">
          <div className="stack stack-2">
            <h2>Administrator tools</h2>
            <p className="muted small">Manage users, feature events and view platform analytics.</p>
          </div>
          <Link to="/admin" className="btn btn-outline">
            Open admin console
          </Link>
        </section>
      )}
    </div>
  );
}

function AttendeeDashboard({ tickets, recommended }) {
  return (
    <>
      <section className="stat-grid">
        <Stat label="Upcoming tickets" value={tickets.upcoming} />
        <Stat label="On a waitlist" value={tickets.waitlisted} />
        <Stat label="Cancelled" value={tickets.cancelled} />
        <Stat label="Total bookings" value={tickets.upcoming + tickets.waitlisted} />
      </section>

      <section className="stack stack-4">
        <div className="row between wrap row-3">
          <h2>Recommended for you</h2>
          <Link to="/tickets" className="small">
            View my tickets
          </Link>
        </div>

        {recommended.length === 0 ? (
          <EmptyState
            title="No recommendations yet"
            action={
              <Link to="/events" className="btn">
                Browse events
              </Link>
            }
          >
            Once there are upcoming events on the platform they will show up here.
          </EmptyState>
        ) : (
          <div className="table-wrap card card-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th className="num">Seats left</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recommended.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Link to={`/events/${event.id}`}>{event.title}</Link>
                    </td>
                    <td>{formatDate(event.date)}</td>
                    <td className="num">{event.seatsLeft}</td>
                    <td className="num">
                      <Link to={`/events/${event.id}`} className="btn btn-sm btn-outline">
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function OrganizerDashboard({ data, eventsQuery, scope, setScope, onTogglePublish, busyId }) {
  const { organizer, topEvents, suggested } = data;

  return (
    <>
      <section className="stat-grid">
        <Stat label="My events" value={organizer.events.total} hint={`${organizer.events.published} published`} />
        <Stat label="Confirmed bookings" value={organizer.registrations} />
        <Stat label="On a waitlist" value={organizer.waitlisted} />
        <Stat label="Check-ins" value={organizer.checkins} />
        <Stat
          label="Average fill rate"
          value={`${organizer.averageFillRate}%`}
          hint={`${organizer.totalCapacity} seats offered`}
        />
      </section>

      <section className="stack stack-4">
        <div className="row between wrap row-3">
          <h2>My events</h2>
          <div className="row wrap row-2">
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chip ${scope === option.value ? 'active' : ''}`}
                onClick={() => setScope(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {eventsQuery.isPending ? (
          <SkeletonGrid count={3} />
        ) : eventsQuery.isError ? (
          <ErrorState error={eventsQuery.error} onRetry={eventsQuery.refetch} />
        ) : eventsQuery.data.length === 0 ? (
          <EmptyState
            title="You have not created any events"
            action={
              <Link to="/events/new" className="btn">
                Create your first event
              </Link>
            }
          >
            Published events appear here with registration numbers, waitlists and check-in tools.
          </EmptyState>
        ) : (
          <div className="table-wrap card card-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th className="num">Booked</th>
                  <th className="num">Waitlist</th>
                  <th>Status</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {eventsQuery.data.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Link to={`/events/${event.id}`}>{event.title}</Link>
                      <div className="tiny muted">
                        {event.venue}, {event.city} &middot; {formatPrice(event.price)}
                      </div>
                    </td>
                    <td>{formatDate(event.date)}</td>
                    <td className="num">
                      {event.capacity - event.seatsLeft} / {event.capacity}
                    </td>
                    <td className="num">{event.waitlistCount}</td>
                    <td>
                      <span className={`badge ${event.isPublished ? 'badge-success' : 'badge-warning'}`}>
                        {event.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td className="num">
                      <div className="row end row-2">
                        <Link to={`/events/${event.id}/manage`} className="btn btn-sm btn-outline">
                          Manage
                        </Link>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => onTogglePublish(event)}
                          disabled={busyId === event.id}
                        >
                          {event.isPublished ? 'Unpublish' : 'Publish'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {topEvents?.length > 0 && (
        <section className="grid-2">
          <div className="card stack stack-3">
            <h2 className="card-title">Busiest events on the platform</h2>
            <ol className="stack stack-2" style={{ paddingLeft: 18 }}>
              {topEvents.map((event) => (
                <li key={event.id} className="row between row-3">
                  <Link to={`/events/${event.id}`}>{event.title}</Link>
                  <span className="muted small">
                    {event.confirmed} / {event.capacity}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="card stack stack-3">
            <h2 className="card-title">Suggested for your audience</h2>
            <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
              {suggested.slice(0, 5).map((event) => (
                <li key={event.id} className="row between row-3">
                  <Link to={`/events/${event.id}`}>{event.title}</Link>
                  <span className="muted small">{event.seatsLeft} seats left</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export { Stat };
