import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/** Mirrors the server's password rule so the user finds out before submitting. */
function scorePassword(value) {
  const rules = [
    { label: 'At least 8 characters', ok: value.length >= 8 },
    { label: 'A lowercase letter', ok: /[a-z]/.test(value) },
    { label: 'An uppercase letter', ok: /[A-Z]/.test(value) },
    { label: 'A number', ok: /[0-9]/.test(value) },
  ];
  return rules;
}

export default function Register() {
  const { signUp, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', organisation: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [pending, setPending] = useState(false);

  const rules = useMemo(() => scorePassword(form.password), [form.password]);

  // Already signed in - no reason to show the form again.
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const payload = { name: form.name, email: form.email, password: form.password };
      if (form.organisation.trim()) payload.organisation = form.organisation.trim();

      await signUp(payload);
      navigate('/dashboard', { replace: true });
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
            <h1>Create your account</h1>
            <p className="muted small">Book events, or organise them if you host something.</p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              className="input"
              autoComplete="name"
              required
              value={form.name}
              aria-invalid={Boolean(fieldErrors.name)}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {fieldErrors.name && <span className="error-text">{fieldErrors.name}</span>}
          </div>

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
            <label className="label" htmlFor="organisation">
              Organisation <span className="muted">(optional)</span>
            </label>
            <input
              id="organisation"
              className="input"
              value={form.organisation}
              onChange={(e) => setForm({ ...form, organisation: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby="password-rules"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <ul id="password-rules" className="stack stack-1 tiny" style={{ listStyle: 'none', padding: 0 }}>
              {rules.map((rule) => (
                <li key={rule.label} style={{ color: rule.ok ? 'var(--success-600)' : 'var(--ink-500)' }}>
                  {rule.ok ? '✓' : '○'} {rule.label}
                </li>
              ))}
            </ul>
            {fieldErrors.password && <span className="error-text">{fieldErrors.password}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="confirm">
              Confirm password
            </label>
            <input
              id="confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </div>

          <button type="submit" className="btn btn-lg btn-block" disabled={pending}>
            {pending ? 'Creating account' : 'Create account'}
          </button>

          <p className="tiny muted text-center">
            The very first account on a new install becomes the platform administrator.
          </p>

          <p className="small text-center muted">
            Already registered? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
