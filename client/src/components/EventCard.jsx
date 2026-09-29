import { Link } from 'react-router-dom';
import { formatDate, formatTime, seatLabel, seatTone, avatarLetter, formatPrice } from '../utils/format.js';

/**
 * The event card used on the home page, the browse grid and the dashboards.
 * Renders as a link so it is keyboard- and screen-reader-navigable.
 */
export default function EventCard({ event, showStatus = false }) {
  const accent = event.category?.accent ?? '#4f46e5';

  return (
    <Link to={`/events/${event.id}`} className="event-card">
      <div className="event-card-media" style={{ background: `linear-gradient(135deg, ${accent}, #1e1b4b)` }}>
        {event.imageUrl ? (
          <img src={event.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="event-card-initial" aria-hidden="true">
            {avatarLetter(event.title)}
          </span>
        )}

        <div className="event-card-badges">
          {event.isFeatured && !showStatus && (
            <span className="badge badge-warning">Featured</span>
          )}
          {showStatus && (
            <span className={`badge badge-on-media ${event.isPublished ? '' : 'badge-warning'}`}>
              {event.isPublished ? 'Published' : 'Draft'}
            </span>
          )}
          {hasStarted(event) && <span className="badge badge-on-media">Finished</span>}
          {event.seatsLeft === 0 && event.waitlistCount > 0 && (
            <span className="badge badge-on-media">Waitlist open</span>
          )}
        </div>
      </div>

      <div className="event-card-body">
        <h3 className="event-card-title">{event.title}</h3>

        <div className="event-card-meta">
          <span>
            {formatDate(event.date)} {event.startTime ? `at ${formatTime(event.startTime)}` : ''}
          </span>
          <span>
            {event.venue}, {event.city}
          </span>
        </div>

        <div className="meter" aria-hidden="true">
          <div
            className={`meter-fill ${seatTone(event)}`}
            style={{ width: `${Math.min(100, event.fillRate)}%` }}
          />
        </div>
      </div>

      <div className="event-card-foot">
        <span className={event.seatsLeft === 0 ? 'muted bold' : 'muted'}>{seatLabel(event)}</span>
        <span className={`badge ${event.isFree ? 'badge-success' : 'badge-brand'}`}>
          {formatPrice(event.price)}
        </span>
      </div>
    </Link>
  );
}

function hasStarted(event) {
  if (!event.date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return event.date < today;
}
