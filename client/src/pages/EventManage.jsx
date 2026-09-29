import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEventDetail, useAttendees } from '../hooks/useApi.js';
import { eventService } from '../services/eventService.js';
import { downloadCsv } from '../services/registrationService.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, ErrorState, EmptyState } from '../components/Feedback.jsx';
import Modal from '../components/Modal.jsx';
import { formatDate, formatTime, formatLocation, formatPrice } from '../utils/format.js';

const STATUSES = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'waitlisted', label: 'Waitlist' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'Everyone' },
];

/** Organiser control room for a single event. */
export default function EventManage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useEventDetail(id);
  const [status, setStatus] = useState('confirmed');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);

  const attendeesQuery = useAttendees(id, { status, search, page, limit: 100 });

  const togglePublish = useMutation({
    mutationFn: () => eventService.publish(id, !data.event.isPublished),
    onSuccess: () => {
      toast.success(data.event.isPublished ? 'Event unpublished.' : 'Event published.');
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => eventService.remove(id),
    onSuccess: () => {
      toast.success('Event deleted.');
      queryClient.invalidateQueries({ queryKey: ['events'] });
      navigate('/manage', { replace: true });
    },
    onError: (err) => {
      toast.error(err.message);
      setConfirmDelete(false);
    },
  });

  if (isPending) return <Spinner label="Loading event" />;
  if (isError) return <ErrorState error={error} />;

  const { event, stats } = data;

  if (!event.canManage) {
    return (
      <div className="container">
        <div className="alert alert-error">You can only manage events that you created.</div>
      </div>
    );
  }

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(
        `/events/${id}/attendees.csv`,
        { status },
        `${event.title.replace(/[^\w-]+/g, '-').toLowerCase()}-attendees.csv`
      );
      toast.success('Attendee list exported.');
    } catch (err) {
      toast.error(err.message || 'The export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="container stack stack-6">
      <nav className="row row-2 small muted wrap">
        <Link to="/manage">Manage</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/events/${id}`}>{event.title}</Link>
      </nav>

      <header className="row between wrap row-4">
        <div className="stack stack-2">
          <h1>{event.title}</h1>
          <p className="muted">
            {formatDate(event.date)} &middot; {formatTime(event.startTime)} &middot; {event.venue},{' '}
            {formatLocation(event.city, event.country)} &middot; {formatPrice(event.price)}
          </p>
          <div className="row wrap row-2">
            <span className={`badge ${event.isPublished ? 'badge-success' : 'badge-warning'}`}>
              {event.isPublished ? 'Published' : 'Draft'}
            </span>
            {event.isFeatured && <span className="badge badge-warning">Featured</span>}
            <span className="badge">
              {stats.confirmed} / {event.capacity} booked
            </span>
            {stats.waitlisted > 0 && <span className="badge badge-warning">{stats.waitlisted} waitlisted</span>}
            {stats.checkedIn > 0 && <span className="badge badge-info">{stats.checkedIn} checked in</span>}
          </div>
        </div>

        <div className="row wrap row-2">
          <Link to={`/check-in?event=${id}`} className="btn btn-outline">
            Check-in scanner
          </Link>
          <Link to={`/events/${id}/edit`} className="btn btn-outline">
            Edit
          </Link>
          <button
            type="button"
            className="btn"
            onClick={() => togglePublish.mutate()}
            disabled={togglePublish.isPending}
          >
            {event.isPublished ? 'Unpublish' : 'Publish'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        </div>
      </header>

      <section className="stat-grid">
        <StatBox label="Confirmed" value={stats.confirmed} />
        <StatBox label="Seats left" value={Math.max(0, event.capacity - stats.confirmed)} />
        <StatBox label="Waitlist" value={stats.waitlisted} />
        <StatBox label="Cancelled" value={stats.cancelled} />
        <StatBox label="Checked in" value={stats.checkedIn} />
      </section>

      <section className="stack stack-4">
        <div className="row between wrap row-3">
          <h2>Attendees</h2>
          <div className="row wrap row-2">
            <label className="sr-only" htmlFor="attendee-search">
              Search attendees
            </label>
            <input
              id="attendee-search"
              className="input"
              type="search"
              placeholder="Search name, email or ticket"
              value={search}
              style={{ width: 220 }}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv} disabled={exporting}>
              {exporting ? 'Exporting' : 'Export CSV'}
            </button>
          </div>
        </div>

        <div className="row wrap row-2">
          {STATUSES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`chip ${status === option.value ? 'active' : ''}`}
              onClick={() => {
                setStatus(option.value);
                setPage(1);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        {attendeesQuery.isPending ? (
          <Spinner label="Loading attendees" />
        ) : attendeesQuery.isError ? (
          <ErrorState error={attendeesQuery.error} onRetry={attendeesQuery.refetch} />
        ) : attendeesQuery.data.attendees.length === 0 ? (
          <EmptyState title="No attendees in this list">
            {search ? 'Try a different search term.' : 'Registrations will appear here as people book.'}
          </EmptyState>
        ) : (
          <div className="table-wrap card card-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Attendee</th>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th>Booked</th>
                  <th>Check-in</th>
                </tr>
              </thead>
              <tbody>
                {attendeesQuery.data.attendees.map((attendee) => (
                  <tr key={attendee.id}>
                    <td>
                      <div className="bold">{attendee.attendee.name}</div>
                      <div className="tiny muted">{attendee.attendee.email}</div>
                    </td>
                    <td className="ticket-number" style={{ fontSize: '0.85rem' }}>
                      {attendee.ticketNumber}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          attendee.status === 'confirmed'
                            ? 'badge-success'
                            : attendee.status === 'waitlisted'
                              ? 'badge-warning'
                              : 'badge-danger'
                        }`}
                      >
                        {attendee.status}
                      </span>
                    </td>
                    <td className="small muted">
                      {attendee.registeredAt ? new Date(attendee.registeredAt).toLocaleDateString() : '-'}
                    </td>
                    <td>
                      {attendee.isCheckedIn ? (
                        <span className="badge badge-info">
                          {new Date(attendee.checkedInAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      ) : (
                        <span className="muted small">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {attendeesQuery.data?.meta?.pages > 1 && (
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
              Page {page} of {attendeesQuery.data.meta.pages}
            </span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={page >= attendeesQuery.data.meta.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this event?"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Deleting' : 'Delete permanently'}
            </button>
          </>
        }
      >
        <p>
          This removes the event and every registration, ticket and review attached to it. This
          cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
