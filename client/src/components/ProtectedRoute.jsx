import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from './Feedback.jsx';

/**
 * Gate for authenticated screens.
 *
 * We render a spinner while the session is being restored rather than
 * redirecting, otherwise a refresh on a protected URL would bounce a
 * signed-in user to /login before the token check finished.
 */
export default function ProtectedRoute({ children, requireRole = [] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <Spinner label="Checking your session" />;

  if (!isAuthenticated) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireRole.length && !requireRole.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
