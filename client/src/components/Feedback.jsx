/** Consistent empty / loading / error blocks so every page behaves the same. */

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty-state">
      <h3>Something went wrong</h3>
      <p>{error?.message ?? 'We could not load this content. Please try again.'}</p>
      {onRetry && (
        <button type="button" className="btn btn-outline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Renders the right state for a react-query result. */
export function QueryBoundary({ query, children, skeleton, empty }) {
  if (query.isPending) return skeleton ?? <Spinner />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  if (empty && !query.data?.length) return empty;
  return children(query.data, query);
}
