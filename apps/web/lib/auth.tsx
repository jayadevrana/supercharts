'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface MeResponse {
  user: AuthUser | null;
  googleEnabled: boolean;
}

interface SessionValue {
  user: AuthUser | null;
  googleEnabled: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<MeResponse>('/auth/me');
      setUser(me.user);
      setGoogleEnabled(me.googleEnabled);
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
    () => ({ user, googleEnabled, loading, refresh, signOut }),
    [user, googleEnabled, loading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}
