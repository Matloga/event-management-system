import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useHomeData, useCategories } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import EventCard from '../components/EventCard.jsx';
import { SkeletonGrid, ErrorState } from '../components/Feedback.jsx';

export default function Home() {
  const { isAuthenticated, isOrganizer } = useAuth();
  const { data, isPending, isError, error, refetch } = useHomeData();
  const { data: categoryList } = useCategories();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const submitSearch = (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    navigate(`/events?${params.toString()}`);
  };

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Find what is happening near you</h1>
          <p>
            Concerts, workshops, sports and community gatherings across South Africa. Book a seat in
            seconds and keep your ticket on your phone.
          </p>

          <form className="hero-search" onSubmit={submitSearch} role="search">
            <label className="sr-only" htmlFor="home-search">
              Search events
            </label>
            <input
              id="home-search"
              className="input"
              type="search"
              placeholder="Search by title, venue or organiser"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" className="btn btn-lg">
              Search
            </button>
          </form>
        </div>
      </section>

      <div className="container stack stack-8">
        {isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <>
            {isPending ? (
              <SkeletonGrid count={3} />
            ) : (
              data.featured.length > 0 && (
                <Section
                  title="Featured events"
                  hint="Hand-picked by the Eventide team"
                  action={<Link to="/events?scope=featured">See all</Link>}
                >
                  {data.featured.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </Section>
              )
            )}

            {isPending ? (
              <SkeletonGrid count={3} />
            ) : (
              <>
                <Section
                  title="Happening soon"
                  action={<Link to="/events?scope=upcoming">See all upcoming</Link>}
                >
                  {data.upcoming.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </Section>

                {data.cities.length > 0 && (
                  <section className="stack stack-3">
                    <h2>Browse by city</h2>
                    <div className="row wrap row-2">
                      {data.cities.map((city) => (
                        <Link
                          key={`${city.city}-${city.country}`}
                          to={`/events?city=${encodeURIComponent(city.city)}`}
                          className="chip"
                        >
                          {city.city}
                          {city.eventCount > 0 && (
                            <span className="muted"> &middot; {city.eventCount}</span>
                          )}
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {categoryList?.length > 0 && (
                  <section className="stack stack-3">
                    <h2>Browse by category</h2>
                    <div className="row wrap row-2">
                      {categoryList.map((category) => (
                        <Link
                          key={category.id}
                          to={`/events?category=${encodeURIComponent(category.slug)}`}
                          className="chip"
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: category.accent,
                              marginRight: 6,
                            }}
                          />
                          {category.name}
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                <Section title="Trending now" hint="Most booked events">
                  {data.popular.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </Section>
              </>
            )}
          </>
        )}

        {!isAuthenticated && (
          <section className="panel row between wrap row-6">
            <div className="stack stack-2">
              <h2>Host events of your own</h2>
              <p className="muted" style={{ maxWidth: '52ch' }}>
                Publish a listing, manage registrations from a single dashboard and let attendees
                check in by QR code. It is free to get started.
              </p>
            </div>
            <Link to="/register" className="btn btn-lg">
              Create an account
            </Link>
          </section>
        )}

        {isOrganizer && (
          <section className="panel row between wrap row-6">
            <div className="stack stack-2">
              <h2>Ready to publish something?</h2>
              <p className="muted">Create an event and it goes live the moment you are ready.</p>
            </div>
            <Link to="/events/new" className="btn btn-lg">
              Create event
            </Link>
          </section>
        )}
      </div>
    </>
  );
}

function Section({ title, hint, action, children }) {
  return (
    <section className="stack stack-4">
      <div className="row between wrap row-3">
        <div>
          <h2>{title}</h2>
          {hint && <p className="muted small">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
