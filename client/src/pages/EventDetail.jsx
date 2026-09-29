import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEventDetail } from '../hooks/useApi.js';
import { eventService } from '../services/eventService.js';
import { registrationService } from '../services/registrationService.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, ErrorState } from '../components/Feedback.jsx';
import Modal from '../components/Modal.jsx';
import {
  formatLongDate,
  formatTime,
  formatLocation,
  formatPrice,
  seatLabel,
  seatTone,
} from '../utils/format.js';

export default function EventDetail() {
  const { id } = useParams();
  const { data, isPending, isError, error, refetch } = useEventDetail(id);
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [confirmCancel, setConfirmCancel] = useState(false);

  // Is the signed-in user already booked? A 404 simply means "not registered".
  const ticketQuery = useQuery({
    queryKey: ['ticket', id, user?.id],
    queryFn: () => registrationService.ticket(id),
    enabled: isAuthenticated,
    retry: false,
  });
  const myTicket = ticketQuery.data?.data ?? null;

  const register = useMutation({
    mutationFn: (waitlist) => eventService.register(id, waitlist ? { waitlist: true } : {}),
    onSuccess: (result) => {
      const { status, position } = result.data;
      if (status === 'waitlisted') {
        toast.success(`You are number ${position} on the waitlist. We will email you if a seat opens.`);
      } else {
        toast.success('You are going. Your ticket is ready.');
      }
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const cancel = useMutation({
    mutationFn: () => eventService.cancelRegistration(id),
    onSuccess: () => {
      toast.success('Your registration has been cancelled.');
      setConfirmCancel(false);
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const addReview = useMutation({
    mutationFn: (payload) => eventService.addReview(id, payload),
    onSuccess: () => {
      toast.success('Thanks for the review.');
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isPending) return <Spinner label="Loading event" />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  const { event, ratingSummary, reviews, stats } = data;
  const ended = new Date(`${event.date}T${event.startTime || '00:00'}`) < new Date();
  const isFull = event.seatsLeft === 0;
  const canRegister = !ended && event.isPublished && !event.canManage;

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: event.title, url });
        return;
      } catch {
        /* user dismissed the share sheet - fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to your clipboard.');
    } catch {
      toast.error('Could not copy the link.');
    }
  };

  return (
    <div className="container stack stack-6">
      <nav className="row row-2 small muted">
        <Link to="/events">Events</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/events?category=${event.category.slug}`}>{event.category.name}</Link>
      </nav>

      <div className="grid-sidebar">
        <div className="stack stack-6">
          <article className="panel stack stack-4">
            <div
              className="row wrap row-2"
              style={{ minHeight: 220, borderRadius: 'var(--radius)', alignItems: 'center', justifyContent: 'center' }}
            >
              {event.imageUrl ? (
                <img
                  src={event.imageUrl}
                  alt=""
                  style={{ width: '100%', borderRadius: 'var(--radius)' }}
                />
              ) : (
                <div
                  className="event-card-media"
                  style={{ width: '100%', aspectRatio: '16/6', borderRadius: 'var(--radius)' }}
                >
                  <span className="event-card-initial" aria-hidden="true">
                    {event.title.charAt(0)}
                  </span>
                </div>
              )}
            </div>

            <div className="row wrap row-2">
              <span className="badge badge-brand">{event.category.name}</span>
              {event.isFeatured && <span className="badge badge-warning">Featured</span>}
              {!event.isPublished && <span className="badge badge-danger">Draft - not visible to the public</span>}
              {ended && <span className="badge">This event has ended</span>}
            </div>

            <h1>{event.title}</h1>

            <dl className="grid-2" style={{ margin: 0 }}>
              <div className="row row-3 align-start">
                <span aria-hidden="true">📅</span>
                <div>
                  <dt className="label">When</dt>
                  <dd style={{ margin: 0 }}>
                    {formatLongDate(event.date)}
                    <br />
                    {formatTime(event.startTime)}
                    {event.endTime ? ` - ${formatTime(event.endTime)}` : ''}
                  </dd>
                </div>
              </div>

              <div className="row row-3 align-start">
                <span aria-hidden="true">📍</span>
                <div>
                  <dt className="label">Where</dt>
                  <dd style={{ margin: 0 }}>
                    {event.venue}
                    {event.address ? `, ${event.address}` : ''}
                    <br />
                    {formatLocation(event.city, event.country)}
                  </dd>
                </div>
              </div>
            </dl>

            <hr className="divider" />

            <div className="stack stack-3">
              <h2>About this event</h2>
              <p style={{ whiteSpace: 'pre-wrap' }}>{event.description}</p>
            </div>

            <p className="small muted">
              Hosted by <strong>{event.organizer.name}</strong>
            </p>
          </article>

          <section className="panel stack stack-4">
            <div className="row between wrap row-3">
              <h2>Ratings and reviews</h2>
              {ratingSummary.count > 0 && (
                <span className="badge badge-brand">
                  {ratingSummary.average.toFixed(1)} / 5 &middot; {ratingSummary.count} review
                  {ratingSummary.count === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {myTicket?.status === 'confirmed' && (
              <ReviewForm onSubmit={(payload) => addReview.mutate(payload)} pending={addReview.isPending} />
            )}

            {reviews.length === 0 ? (
              <p className="muted">No reviews yet. Attendees can rate this event after booking.</p>
            ) : (
              <ul className="stack stack-4" style={{ listStyle: 'none', padding: 0 }}>
                {reviews.map((review) => (
                  <li key={review.id} className="stack stack-2">
                    <div className="row between row-3">
                      <strong>{review.author?.name ?? 'Attendee'}</strong>
                      <span className="badge" aria-label={`${review.rating} out of 5`}>
                        {'★'.repeat(review.rating)}
                      </span>
                    </div>
                    {review.comment && <p>{review.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="stack stack-4">
          <section className="card stack stack-4">
            <div className="row between row-3">
              <span className="stat-value" style={{ fontSize: '1.4rem' }}>
                {formatPrice(event.price)}
              </span>
              <span className={`badge ${event.isFree ? 'badge-success' : 'badge-brand'}`}>
                {event.isFree ? 'Free entry' : 'Ticketed'}
              </span>
            </div>

            <div className="stack stack-2">
              <div className="row between small">
                <span className="muted">{stats.confirmed} booked</span>
                <span className="muted">{event.capacity} capacity</span>
              </div>
              <div className="meter" aria-hidden="true">
                <div
                  className={`meter-fill ${seatTone(event)}`}
                  style={{ width: `${Math.min(100, event.fillRate)}%` }}
                />
              </div>
              <span className="small muted">{seatLabel(event)}</span>
            </div>

            <BookingPanel
              isAuthenticated={isAuthenticated}
              canRegister={canRegister}
              isFull={isFull}
              eventIsFree={event.isFree}
              myTicket={myTicket}
              onRequireLogin={() => navigate('/login', { state: { from: { pathname: `/events/${id}` } } })}
              onRegister={(waitlist) => register.mutate(waitlist)}
              onCancel={() => setConfirmCancel(true)}
              pending={register.isPending}
            />

            <hr className="divider" />

            <button type="button" className="btn btn-outline btn-block" onClick={share}>
              Share event
            </button>

            {event.canManage && (
              <Link to={`/events/${id}/manage`} className="btn btn-block">
                Manage this event
              </Link>
            )}
          </section>

          <section className="card stack stack-3">
            <h2 className="card-title">Good to know</h2>
            <ul className="stack stack-2 small" style={{ paddingLeft: 18 }}>
              <li>Tickets are free to cancel up to 24 hours before the event.</li>
              <li>Your QR code is issued as soon as a seat is confirmed.</li>
              <li>Waitlisted attendees are promoted automatically when someone cancels.</li>
            </ul>
          </section>
        </aside>
      </div>

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel your registration?"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(false)}>
              Keep my seat
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Cancelling' : 'Yes, cancel it'}
            </button>
          </>
        }
      >
        <p>
          Your seat will be released and offered to the first person on the waitlist. You can register
          again later if seats are still available.
        </p>
      </Modal>
    </div>
  );
}

function BookingPanel({
  isAuthenticated,
  canRegister,
  isFull,
  eventIsFree,
  myTicket,
  onRequireLogin,
  onRegister,
  onCancel,
  pending,
}) {
  if (myTicket) {
    return (
      <div className="stack stack-3">
        <div className="alert alert-success">
          <span>
            <strong>
              {myTicket.status === 'confirmed'
                ? 'You are going'
                : myTicket.status === 'waitlisted'
                  ? 'You are on the waitlist'
                  : 'Registration cancelled'}
            </strong>
            <br />
            <span className="small">Ticket {myTicket.ticketNumber}</span>
          </span>
        </div>

        {myTicket.status === 'confirmed' && (
          <Link to="/tickets" className="btn btn-block">
            View my ticket
          </Link>
        )}
        {myTicket.status === 'confirmed' && (
          <button type="button" className="btn btn-ghost btn-block" onClick={onCancel}>
            Cancel registration
          </button>
        )}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="stack stack-3">
        <button type="button" className="btn btn-block" onClick={onRequireLogin}>
          Sign in to book
        </button>
        <p className="tiny muted text-center">You need an account to book a seat.</p>
      </div>
    );
  }

  if (!canRegister) return null;

  const label = eventIsFree ? 'Register free' : 'Reserve my seat';

  if (isFull) {
    return (
      <div className="stack stack-3">
        <button type="button" className="btn btn-block" onClick={() => onRegister(true)} disabled={pending}>
          {pending ? 'Joining' : 'Join the waitlist'}
        </button>
        <p className="tiny muted text-center">
          All seats are taken. Waitlisted people are promoted automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="stack stack-3">
      <button type="button" className="btn btn-lg btn-block" onClick={() => onRegister(false)} disabled={pending}>
        {pending ? 'Booking' : label}
      </button>
      {!eventIsFree && (
        <p className="tiny muted text-center">
          Payment is collected at the door, so your seat is held as soon as you register.
        </p>
      )}
    </div>
  );
}

function ReviewForm({ onSubmit, pending }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  return (
    <form
      className="card stack stack-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ rating, comment: comment.trim() || undefined });
        setComment('');
      }}
    >
      <h3 className="card-title">Leave a review</h3>

      <div className="field">
        <span className="label" id="rating-label">
          Your rating
        </span>
        <div className="row row-2" role="radiogroup" aria-labelledby="rating-label">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={`${value} star${value === 1 ? '' : 's'}`}
              className="chip"
              style={{
                background: rating >= value ? 'var(--brand-600)' : undefined,
                color: rating >= value ? '#fff' : undefined,
                borderColor: rating >= value ? 'var(--brand-600)' : undefined,
              }}
              onClick={() => setRating(value)}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="review-comment">
          Comment (optional)
        </label>
        <textarea
          id="review-comment"
          className="textarea"
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="How was the event?"
        />
      </div>

      <button type="submit" className="btn btn-sm" disabled={pending}>
        {pending ? 'Posting' : 'Post review'}
      </button>
    </form>
  );
}
