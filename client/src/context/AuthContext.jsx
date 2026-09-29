import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authService } from '../services/authService.js';
import { onUnauthorized, tokenStore } from '../services/api.js';

const AuthContext = createContext(null);

/**
 * Session state.
 *
 * The token lives in localStorage so a refresh keeps you signed in. On mount
 * we verify the token against /auth/me rather than trusting it, so a revoked
 * or expired token cannot leave the UI showing a signed-in shell.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // No stored token means we are anonymous straight away - no effect needed.
  const [status, setStatus] = useState(() => (tokenStore.get() ? 'loading' : 'anonymous'));

  const signOut = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
    // Fire and forget; the endpoint exists so the intent is recorded server-side.
    authService.logout().catch(() => {});
  }, []);

  // Restore a session on first load.
  useEffect(() => {
    if (!tokenStore.get()) return undefined;

    let cancelled = false;

    authService
      .me()
      .then(({ data }) => {
        if (cancelled) return;
        setUser(data.user);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        tokenStore.clear();
        setStatus('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from anywhere in the app ends the session.
  useEffect(() => onUnauthorized(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
  }), []);

  const signIn = useCallback(async (credentials) => {
    const { data } = await authService.login(credentials);
    tokenStore.set(data.token);
    setUser(data.user);
    setStatus('authenticated');
    return data.user;
  }, []);

  const signUp = useCallback(async (payload) => {
    const { data } = await authService.register(payload);
    tokenStore.set(data.token);
    setUser(data.user);
    setStatus('authenticated');
    return data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated',
      isLoading: status === 'loading',
      isOrganizer: user?.role === 'organizer' || user?.role === 'admin',
      isAdmin: user?.role === 'admin',
      signIn,
      signUp,
      signOut,
      setUser,
    }),
    [user, status, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an <AuthProvider>');
  return context;
}
