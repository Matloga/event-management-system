import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { eventService } from '../services/eventService.js';
import { registrationService } from '../services/registrationService.js';
import { adminService } from '../services/adminService.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Query hooks. Keeping them here (rather than inside pages) means the cache
 * key for "the event list" is defined once, so two pages showing it revalidate
 * together.
 */

export function useHomeData() {
  return useQuery({ queryKey: ['events', 'home'], queryFn: () => eventService.home(), staleTime: 60_000 });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => eventService.categories(), staleTime: 10 * 60_000 });
}

/** Filters are read straight from the URL so a search is shareable and survives a refresh. */
export function useEventList() {
  const [searchParams] = useSearchParams();

  const filters = Object.fromEntries(
    [...searchParams.entries()].filter(([, value]) => value !== '' && value != null)
  );

  return useQuery({
    queryKey: ['events', 'list', filters],
    queryFn: () => eventService.list(filters),
    // Keeps the previous page on screen while the next one loads, so the grid
    // does not flash empty on every filter change.
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useEventDetail(id) {
  return useQuery({
    queryKey: ['events', 'detail', id],
    queryFn: () => eventService.detail(id),
    enabled: Boolean(id),
  });
}

export function useMyEvents(params) {
  return useQuery({
    queryKey: ['events', 'mine', params],
    queryFn: () => eventService.mine(params),
    enabled: params != null,
  });
}

export function useMyTickets(scope = 'upcoming') {
  return useQuery({ queryKey: ['tickets', scope], queryFn: () => registrationService.mine(scope) });
}

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => adminService.dashboard() });
}

export function useAdminStats(days = 30) {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'stats', days],
    queryFn: () => adminService.stats(days),
    enabled: isAdmin,
  });
}

export function useAttendees(eventId, params) {
  return useQuery({
    queryKey: ['attendees', eventId, params],
    queryFn: () => eventService.attendees(eventId, params),
    enabled: Boolean(eventId) && params != null,
  });
}
