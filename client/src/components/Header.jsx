import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Header() {
  const { isAuthenticated, user, isOrganizer, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Any click inside the menu closes it, which covers navigation on mobile.
  const close = () => setOpen(false);

  const handleSignOut = () => {
    signOut();
    navigate('/');
  };

  return (
    <header className="site-header">
      <div className="container">
        <Link to="/" className="brand" onClick={close}>
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span>Eventide</span>
        </Link>

        <button
          type="button"
          className="btn btn-outline btn-sm nav-toggle"
          aria-expanded={open}
          aria-controls="primary-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close' : 'Menu'}
        </button>

        <nav id="primary-nav" className={`nav ${open ? 'open' : ''}`} onClick={close}>
          <NavLink to="/events" className="nav-link">
            Browse events
          </NavLink>

          {isAuthenticated && (
            <NavLink to="/tickets" className="nav-link">
              My tickets
            </NavLink>
          )}

          {isOrganizer && (
            <NavLink to="/manage" className="nav-link">
              Manage
            </NavLink>
          )}

          {user?.role === 'admin' && (
            <NavLink to="/admin" className="nav-link">
              Admin
            </NavLink>
          )}

          {isAuthenticated ? (
            <>
              <NavLink to="/profile" className="nav-link">
                {user.name}
              </NavLink>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className="nav-link">
                Sign in
              </NavLink>
              <Link to="/register" className="btn btn-sm">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
