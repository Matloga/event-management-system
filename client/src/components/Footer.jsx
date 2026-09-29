import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container row between wrap row-4">
        <span>&copy; {new Date().getFullYear()} Eventide - Event Management System</span>
        <nav className="row row-4" aria-label="Footer">
          <Link to="/events">Browse events</Link>
          <Link to="/events?scope=upcoming">Upcoming</Link>
          <Link to="/register">Become an organiser</Link>
        </nav>
      </div>
    </footer>
  );
}
