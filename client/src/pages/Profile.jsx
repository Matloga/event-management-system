import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authService } from '../services/authService.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Link } from 'react-router-dom';
import { formatDate } from '../utils/format.js';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState({
    name: user.name ?? '',
    organisation: user.organisation ?? '',
    phone: user.phone ?? '',
    bio: user.bio ?? '',
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordFields, setPasswordFields] = useState({});

  const saveProfile = useMutation({
    mutationFn: () => authService.updateProfile(profile),
    onSuccess: ({ data }) => {
      setUser(data.user);
      toast.success('Profile updated.');
    },
    onError: (err) => {
      setProfileError(err.message);
      if (err.fieldErrors) setProfileError(Object.values(err.fieldErrors).join(' '));
    },
  });

  const changePassword = useMutation({
    mutationFn: () => authService.changePassword(passwords),
    onSuccess: () => {
      toast.success('Password changed.');
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
    },
    onError: (err) => {
      setPasswordError(err.message);
      if (err.fieldErrors) setPasswordFields(err.fieldErrors);
    },
  });

  const submitPassword = (event) => {
    event.preventDefault();
    setPasswordError('');

    if (passwords.newPassword !== passwords.confirm) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    changePassword.mutate();
  };

  return (
    <div className="container stack stack-6" style={{ maxWidth: 800 }}>
      <header className="stack stack-2">
        <h1>Your profile</h1>
        <p className="muted">
          {user.email} &middot; member since {formatDate(user.createdAt)}
        </p>
      </header>

      <form
        className="panel stack stack-4"
        onSubmit={(e) => {
          e.preventDefault();
          setProfileError('');
          saveProfile.mutate();
        }}
        noValidate
      >
        <h2>Personal details</h2>

        {profileError && <div className="alert alert-error">{profileError}</div>}

        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              className="input"
              required
              minLength={2}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="phone">
              Phone
            </label>
            <input
              id="phone"
              className="input"
              type="tel"
              maxLength={32}
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="organisation">
            Organisation
          </label>
          <input
            id="organisation"
            className="input"
            maxLength={120}
            value={profile.organisation}
            onChange={(e) => setProfile({ ...profile, organisation: e.target.value })}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="bio">
            Short bio
          </label>
          <textarea
            id="bio"
            className="textarea"
            maxLength={500}
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="Tell organisers a little about yourself"
          />
        </div>

        <div className="row end">
          <button type="submit" className="btn" disabled={saveProfile.isPending}>
            {saveProfile.isPending ? 'Saving' : 'Save changes'}
          </button>
        </div>
      </form>

      <form className="panel stack stack-4" onSubmit={submitPassword} noValidate>
        <h2>Change password</h2>

        {passwordError && <div className="alert alert-error">{passwordError}</div>}

        <div className="field">
          <label className="label" htmlFor="currentPassword">
            Current password
          </label>
          <input
            id="currentPassword"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={passwords.currentPassword}
            onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
          />
        </div>

        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="newPassword">
              New password
            </label>
            <input
              id="newPassword"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={Boolean(passwordFields.newPassword)}
              value={passwords.newPassword}
              onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
            />
            {passwordFields.newPassword && <span className="error-text">{passwordFields.newPassword}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="confirm">
              Confirm new password
            </label>
            <input
              id="confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={passwords.confirm}
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
            />
          </div>
        </div>

        <p className="tiny muted">At least 8 characters with an uppercase letter, a lowercase letter and a number.</p>

        <div className="row end">
          <button type="submit" className="btn" disabled={changePassword.isPending}>
            {changePassword.isPending ? 'Updating' : 'Update password'}
          </button>
        </div>
      </form>

      <section className="panel stack stack-3">
        <h2>Quick links</h2>
        <div className="row wrap row-4">
          <Link to="/tickets" className="btn btn-outline btn-sm">
            My tickets
          </Link>
          <Link to="/dashboard" className="btn btn-outline btn-sm">
            Dashboard
          </Link>
          <Link to="/events" className="btn btn-outline btn-sm">
            Browse events
          </Link>
        </div>
      </section>
    </div>
  );
}
