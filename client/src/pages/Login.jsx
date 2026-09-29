import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [pending, setPending] = useState(false);

  const from = location.state?.from?.pathname ?? '/dashboard';

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    setPending(true);
    try {
      await signIn(form);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.fieldErrors) setFieldErrors(err.fieldErrors);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <form className="panel stack stack-4" onSubmit={submit} noValidate>
          <div className="stack stack-2">
            <h1>Welcome back</h1>
            <p className="muted small">Sign in to manage your tickets and events.</p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              aria-invalid={Boolean(fieldErrors.email)}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            {fieldErrors.email && <span className="error-text">{fieldErrors.email}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={form.password}
              aria-invalid={Boolean(fieldErrors.password)}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {fieldErrors.password && <span className="error-text">{fieldErrors.password}</span>}
          </div>

          <button type="submit" className="btn btn-lg btn-block" disabled={pending}>
            {pending ? 'Signing in' : 'Sign in'}
          </button>

          <p className="small text-center muted">
            New here? <Link to="/register">Create an account</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
