'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
}

interface MeResponse {
  user: AuthUser | null;
  googleEnabled: boolean;
  hasPassword: boolean;
  providers: string[];
}

interface SessionValue {
  user: AuthUser | null;
  googleEnabled: boolean;
  hasPassword: boolean;
  providers: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<MeResponse>('/auth/me');
      setUser(me.user);
      setGoogleEnabled(me.googleEnabled);
      setHasPassword(me.hasPassword);
      setProviders(me.providers ?? []);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* clearing the cookie is best-effort; navigate regardless */
    }
    setUser(null);
    window.location.href = '/';
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, googleEnabled, hasPassword, providers, loading, refresh, signOut }),
    [user, googleEnabled, hasPassword, providers, loading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}
