import { useSearchParams, Link } from 'react-router-dom';
import { useEventList, useCategories, useHomeData } from '../hooks/useApi.js';
import EventCard from '../components/EventCard.jsx';
import { SkeletonGrid, ErrorState, EmptyState } from '../components/Feedback.jsx';

const SORTS = [
  { value: 'date_asc', label: 'Date: soonest' },
  { value: 'date_desc', label: 'Date: latest' },
  { value: 'popular', label: 'Most booked' },
  { value: 'seats', label: 'Most seats left' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'newest', label: 'Recently added' },
];

const SCOPES = [
  { value: '', label: 'Any time' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past events' },
  { value: 'featured', label: 'Featured' },
];

const PRICING = [
  { value: '', label: 'Any price' },
  { value: 'free', label: 'Free only' },
  { value: 'paid', label: 'Paid only' },
];

/**
 * Browse / search.
 *
 * All filter state lives in the URL, so a filtered view can be shared or
 * bookmarked, and the back button behaves the way people expect.
 */
export default function Events() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, meta, isPending, isError, error, refetch, isPlaceholderData } = useEventList();
  const { data: categories } = useCategories();
  const { data: home } = useHomeData();

  const get = (key) => searchParams.get(key) ?? '';
  const page = Number(get('page') || 1);
  const totalPages = meta?.pages ?? 1;
  const activeCount = ['search', 'category', 'city', 'scope', 'pricing', 'from', 'to'].filter(
    (key) => get(key) !== '' && get(key) !== 'upcoming'
  ).length;

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value === '' || value == null) next.delete(key);
    else next.set(key, value);
    // Any filter change invalidates the current page number.
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const clearAll = () => setSearchParams(new URLSearchParams(), { replace: true });

  return (
    <div className="container stack stack-6">
      <header className="stack stack-2">
        <h1>Browse events</h1>
        <p className="muted">
          {meta ? `${meta.total} event${meta.total === 1 ? '' : 's'} found` : 'Searching the platform'}
        </p>
      </header>

      <div className="grid-sidebar">
        <div className="stack stack-4">
          <div className="field">
            <label className="label" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              className="input"
              type="search"
              placeholder="Title, venue, organiser or description"
              defaultValue={get('search')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setParam('search', e.currentTarget.value.trim());
              }}
              onBlur={(e) => setParam('search', e.target.value.trim())}
            />
          </div>

          <div className="row between wrap row-3">
            <div className="row wrap row-2">
              {SCOPES.map((scope) => (
                <button
                  key={scope.value}
                  type="button"
                  className={`chip ${get('scope') === scope.value ? 'active' : ''}`}
                  onClick={() => setParam('scope', scope.value)}
                >
                  {scope.label}
                </button>
              ))}
            </div>
            <div className="row row-2">
              <label className="sr-only" htmlFor="sort">
                Sort by
              </label>
              <select
                id="sort"
                className="select"
                value={get('sort') || 'date_asc'}
                onChange={(e) => setParam('sort', e.target.value)}
                style={{ width: 'auto' }}
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isError ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : isPending ? (
            <SkeletonGrid count={6} />
          ) : data.length === 0 ? (
            <EmptyState
              title="No events match those filters"
              action={
                activeCount > 0 ? (
                  <button type="button" className="btn btn-outline" onClick={clearAll}>
                    Clear all filters
                  </button>
                ) : null
              }
            >
              Try widening your search, or browse a different city or category.
            </EmptyState>
          ) : (
            <>
              <div className="grid" style={{ opacity: isPlaceholderData ? 0.6 : 1 }}>
                {data.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="row center row-3" aria-label="Pagination">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={page <= 1}
                    onClick={() => setParam('page', String(page - 1))}
                  >
                    Previous
                  </button>
                  <span className="small muted">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={page >= totalPages}
                    onClick={() => setParam('page', String(page + 1))}
                  >
                    Next
                  </button>
                </nav>
              )}
            </>
          )}
        </div>

        <aside className="stack stack-6">
          <section className="card stack stack-4">
            <h2 className="card-title">Filters</h2>

            <div className="field">
              <span className="label">Category</span>
              <select
                className="select"
                value={get('category')}
                onChange={(e) => setParam('category', e.target.value)}
              >
                <option value="">All categories</option>
                {categories?.map((category) => (
                  <option key={category.id} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <span className="label">City</span>
              <select
                className="select"
                value={get('city')}
                onChange={(e) => setParam('city', e.target.value)}
              >
                <option value="">All cities</option>
                {home?.cities?.map((city) => (
                  <option key={city.city} value={city.city}>
                    {city.city} ({city.eventCount})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <span className="label">Price</span>
              <div className="row wrap row-2">
                {PRICING.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`chip ${get('pricing') === option.value ? 'active' : ''}`}
                    onClick={() => setParam('pricing', option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label className="label" htmlFor="from">
                  From
                </label>
                <input
                  id="from"
                  className="input"
                  type="date"
                  value={get('from')}
                  onChange={(e) => setParam('from', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="to">
                  To
                </label>
                <input
                  id="to"
                  className="input"
                  type="date"
                  value={get('to')}
                  onChange={(e) => setParam('to', e.target.value)}
                />
              </div>
            </div>

            {activeCount > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
                Clear all filters ({activeCount})
              </button>
            )}
          </section>

          <section className="card stack stack-3">
            <h2 className="card-title">Quick links</h2>
            <Link to="/events?scope=upcoming">Happening this week</Link>
            <Link to="/events?pricing=free">Free to attend</Link>
            <Link to="/events?scope=featured">Featured events</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
