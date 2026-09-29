import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container">
      <div className="empty-state" style={{ paddingTop: 80 }}>
        <p className="stat-value" style={{ fontSize: '3.5rem' }}>
          404
        </p>
        <h3>We could not find that page</h3>
        <p>The link may be broken, or the event may have been removed by its organiser.</p>
        <div className="row center row-3 wrap">
          <Link to="/" className="btn">
            Back to home
          </Link>
          <Link to="/events" className="btn btn-outline">
            Browse events
          </Link>
        </div>
      </div>
    </div>
  );
}
