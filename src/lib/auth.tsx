import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';

export interface AppUser {
  id: string;
  auth_id: string | null;
  email: string;
  full_name: string | null;
  role: 'user' | 'admin';
  wallet_address?: string | null;
}

export interface OutletContext {
  user: AppUser | null;
}

interface AuthContextType {
  user: AppUser | null;
  session: Session | null;
  isLoading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null; sessionCreated?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updateProfile: (data: { full_name?: string }) => Promise<{ error: Error | null }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getAppOrigin(): string {
  return window.location.origin;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const lastLoadedAuthId = useRef<string | null>(null);
  const initDone = useRef(false);

  const fetchAppUser = useCallback(async (authUser: User): Promise<AppUser> => {
    const minimal: AppUser = {
      id: authUser.id,
      auth_id: authUser.id,
      email: authUser.email!,
      full_name: authUser.user_metadata?.full_name ?? null,
      role: 'user',
    };

    try {
      type ProfileRow = Record<string, unknown>;

      // Try looking up by auth_id first
      const { data: rowByAuthId } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', authUser.id)
        .maybeSingle();

      let row: ProfileRow | null = rowByAuthId as ProfileRow | null;

      // Fallback: look up by email (handles legacy accounts)
      if (!row) {
        const { data: rowByEmail } = await supabase
          .from('users')
          .select('*')
          .eq('email', authUser.email!)
          .maybeSingle();
        row = rowByEmail as ProfileRow | null;
      }

      if (row) {
        // Patch auth_id if missing
        if (!row['auth_id']) {
          supabase
            .from('users')
            .update({ auth_id: authUser.id })
            .eq('id', row['id'])
            .then(() => {});
        }
        return { ...row, auth_id: row['auth_id'] ?? authUser.id } as unknown as AppUser;
      }

      // No row found — create one (trigger should have done this, but fallback client-side)
      const { data: newRow } = await supabase.from('users').upsert(
        {
          auth_id: authUser.id,
          email: authUser.email!,
          full_name: authUser.user_metadata?.full_name ?? null,
          role: 'user',
        },
        { onConflict: 'auth_id' }
      ).select().maybeSingle();

      // Also ensure a balance row exists
      supabase.from('user_balances').upsert(
        { user_email: authUser.email!, balance_usd: 0, total_invested: 0, total_profit_loss: 0 },
        { onConflict: 'user_email' }
      ).then(() => {});

      if (newRow) {
        return newRow as unknown as AppUser;
      }

      return minimal;

    } catch (err) {
      // Tables may not exist yet (schema not applied) — fallback to minimal user
      console.warn('[Salarn] fetchAppUser: using minimal user (schema may not be applied yet):', err);
      return minimal;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const { data: { session: current } } = await supabase.auth.getSession();
    if (current?.user) {
      lastLoadedAuthId.current = null;
      const appUser = await fetchAppUser(current.user);
      setUser(appUser);
    }
  }, [fetchAppUser]);

  useEffect(() => {
    let mounted = true;

    // ── 1. Eagerly load the current session so the UI never hangs ──
    const initAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!mounted || initDone.current) return;

        if (currentSession?.user) {
          setSession(currentSession);
          lastLoadedAuthId.current = currentSession.user.id;
          const appUser = await fetchAppUser(currentSession.user);
          if (mounted) {
            setUser(appUser);
            setIsLoading(false);
          }
        } else {
          if (mounted) {
            setUser(null);
            setSession(null);
            setIsLoading(false);
          }
        }
      } catch {
        if (mounted) setIsLoading(false);
      }
    };

    initAuth();

    // ── 2. Subscribe to real-time auth changes ──
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      initDone.current = true;
      setSession(newSession);

      if (!newSession?.user) {
        lastLoadedAuthId.current = null;
        setUser(null);
        if (mounted) setIsLoading(false);
        return;
      }

      // Skip re-fetching for mere token refreshes if user is already loaded
      if (
        event === 'TOKEN_REFRESHED' &&
        lastLoadedAuthId.current === newSession.user.id &&
        user !== null
      ) {
        if (mounted) setIsLoading(false);
        return;
      }

      lastLoadedAuthId.current = newSession.user.id;
      const appUser = await fetchAppUser(newSession.user);

      if (mounted) {
        setUser(appUser);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAppUser]);

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const origin = getAppOrigin();
      const redirectTo = `${origin}/auth/callback`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: { full_name: fullName },
        },
      });
      if (error) return { error: error as Error };

      // Supabase returns identities: [] when the email is already registered
      if (data?.user && data.user.identities?.length === 0) {
        return { error: new Error('An account with this email already exists. Please sign in.') };
      }

      // session is set immediately when email confirmation is disabled in Supabase
      const sessionCreated = !!(data?.session);
      return { error: null, sessionCreated };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error as Error | null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const origin = getAppOrigin();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/callback`,
      });
      return { error: error as Error | null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const signOut = async () => {
    lastLoadedAuthId.current = null;
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    setUser(null);
    setSession(null);
  };

  const updateProfile = async (data: { full_name?: string }) => {
    if (!user) return { error: new Error('Not authenticated') };
    try {
      const { error } = await supabase
        .from('users')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (!error) setUser(prev => prev ? { ...prev, ...data } : null);
      return { error: error as Error | null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signUp, signIn, signOut, resetPassword, updateProfile, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
