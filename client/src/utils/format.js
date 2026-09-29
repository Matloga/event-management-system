/** Small presentation helpers shared across pages. */
import { format, parseISO, isPast, isToday, isTomorrow } from 'date-fns';

/** '15 Jul 2026' */
export function formatDate(value) {
  if (!value) return 'Date to be confirmed';
  const date = typeof value === 'string' ? parseISO(value) : value;
  return format(date, 'd MMM yyyy');
}

/** 'Saturday, 15 July' */
export function formatLongDate(value) {
  if (!value) return 'Date to be confirmed';
  const date = typeof value === 'string' ? parseISO(value) : value;
  return format(date, 'EEEE, d MMMM');
}

/** 'Today' / 'Tomorrow' / 'Sat, 15 Jul' */
export function formatRelativeDate(value) {
  if (!value) return 'Date to be confirmed';
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEE, d MMM');
}

/** '18:30' -> '6:30 PM' */
export function formatTime(value) {
  if (!value) return '';
  const [h, m] = String(value).split(':');
  const hour = Number(h);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${m} ${suffix}`;
}

/** 'Polokwane, South Africa' */
export function formatLocation(city, country) {
  return [city, country].filter(Boolean).join(', ');
}

/** 'R 350.00' for paid events, 'Free' otherwise. */
export function formatPrice(price) {
  if (!price) return 'Free';
  return `R ${Number(price).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** True when an event date is today or in the past. */
export function hasEnded(date) {
  return date ? isPast(parseISO(date)) : false;
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** 'thandi@example.com' -> 't' for the avatar bubble. */
export function avatarLetter(name, email) {
  if (name) return initials(name).charAt(0);
  return (email ?? '?').charAt(0).toUpperCase();
}

/** Seat availability label for a card or detail page. */
export function seatLabel(event) {
  if (!event) return '';
  if (event.seatsLeft === 0) {
    return event.waitlistCount > 0 ? `Full - ${event.waitlistCount} waiting` : 'Fully booked';
  }
  if (event.seatsLeft <= 5) return `Only ${event.seatsLeft} seat${event.seatsLeft === 1 ? '' : 's'} left`;
  return `${event.seatsLeft} seats left`;
}

export function seatTone(event) {
  if (!event) return '';
  if (event.seatsLeft === 0) return 'is-full';
  if (event.seatsLeft <= 5) return 'is-low';
  return '';
}
