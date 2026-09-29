import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { registrationService } from '../services/registrationService.js';
import { useMyTickets } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, ErrorState, EmptyState } from '../components/Feedback.jsx';
import { formatLongDate, formatTime, formatLocation } from '../utils/format.js';

const SCOPES = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

export default function MyTickets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = SCOPES.some((s) => s.value === searchParams.get('scope'))
    ? searchParams.get('scope')
    : 'upcoming';

  const { data, isPending, isError, error, refetch } = useMyTickets(scope);

  const tabs = SCOPES.map((option) => (
    <button
      key={option.value}
      type="button"
      className={`chip ${scope === option.value ? 'active' : ''}`}
      onClick={() => setSearchParams({ scope: option.value }, { replace: true })}
    >
      {option.label}
    </button>
  ));

  return (
    <div className="container stack stack-6">
      <header className="stack stack-2">
        <h1>My tickets</h1>
        <p className="muted">Your QR codes are ready to scan at the door.</p>
      </header>

      <div className="row wrap row-2">{tabs}</div>

      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isPending ? (
        <Spinner label="Loading your tickets" />
      ) : data.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          action={
            <Link to="/events" className="btn">
              Find an event
            </Link>
          }
        >
          {scope === 'upcoming'
            ? 'You have no upcoming tickets. Browse events and reserve a seat.'
            : 'No tickets in this list.'}
        </EmptyState>
      ) : (
        <div className="grid-2">
          {data.map((ticket) => (
            <Ticket key={ticket.id} ticket={ticket} />
          ))}
        </div>
      )}
    </div>
  );
}

function Ticket({ ticket }) {
  const { user } = useAuth();
  const toast = useToast();
  const [qrUrl, setQrUrl] = useState(null);
  const [loadingQr, setLoadingQr] = useState(false);

  const { event } = ticket;
  const showQr = ticket.status === 'confirmed' || ticket.status === 'waitlisted';

  // Only fetch the QR image once the card is actually expanded.
  useEffect(() => {
    if (!showQr || !qrUrl) return undefined;

    return () => URL.revokeObjectURL(qrUrl);
  }, [qrUrl, showQr]);

  const loadQr = async () => {
    setLoadingQr(true);
    try {
      const url = await registrationService.qrImage(ticket.eventId);
      setQrUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingQr(false);
    }
  };

  return (
    <>
      <article className="ticket">
        <div className="ticket-main stack stack-3">
          <div className="row between wrap row-2">
            <span
              className={`badge ${
                ticket.status === 'confirmed'
                  ? 'badge-success'
                  : ticket.status === 'waitlisted'
                    ? 'badge-warning'
                    : 'badge-danger'
              }`}
            >
              {ticket.status === 'confirmed'
                ? 'Confirmed'
                : ticket.status === 'waitlisted'
                  ? 'Waitlisted'
                  : 'Cancelled'}
            </span>
            {ticket.isCheckedIn && <span className="badge badge-info">Checked in</span>}
          </div>

          <h3 style={{ margin: 0 }}>
            <Link to={`/events/${event.id}`}>{event.title}</Link>
          </h3>

          <div className="small muted stack stack-1">
            <span>
              {formatLongDate(event.date)} &middot; {formatTime(event.startTime)}
            </span>
            <span>
              {event.venue}, {formatLocation(event.city, event.country)}
            </span>
            <span>Organiser: {event.organizerName}</span>
          </div>

          <div className="row between row-3">
            <span className="ticket-number">{ticket.ticketNumber}</span>
            <span className="tiny muted">Booked by {user.name}</span>
          </div>

          <div className="row wrap row-2">
            {showQr && !qrUrl && (
              <button type="button" className="btn btn-sm" onClick={loadQr} disabled={loadingQr}>
                {loadingQr ? 'Loading' : 'Show QR code'}
              </button>
            )}
            <Link to={`/events/${event.id}`} className="btn btn-outline btn-sm">
              Event details
            </Link>
          </div>
        </div>

        {qrUrl && (
          <>
            <div className="ticket-qr">
              <img src={qrUrl} alt={`QR code for ticket ${ticket.ticketNumber}`} width="220" height="220" />
              <p className="tiny muted text-center" style={{ maxWidth: '32ch' }}>
                Show this at the entrance. Screenshots work, but the live code is safer.
              </p>
            </div>
            <div className="ticket-perf">
              <span>Admit one</span>
            </div>
          </>
        )}
      </article>
    </>
  );
}
