import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createBukowskiSupabaseClient,
  resolveBukowskiSupabaseEnv,
  type BukowskiSupabaseClient,
} from "@bukowski/supabase-client";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export type BukowskiSessionUser = {
  id: string;
  email: string | null;
  displayName: string;
};

type SessionContextValue = {
  status: SessionStatus;
  user: BukowskiSessionUser | null;
  supabase: BukowskiSupabaseClient | null;
  isSupabaseConfigured: boolean;
  isLocalFallback: boolean;
  authError: string | null;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithOAuth: (provider: "google" | "github") => Promise<void>;
  signOut: () => Promise<void>;
  handleAuthDeepLink: (url: string) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const toSessionUser = (user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }): BukowskiSessionUser => {
  const displayName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : user.email ?? "BukowskiOS user";

  return {
    id: user.id,
    email: user.email ?? null,
    displayName,
  };
};

const createSupabaseClientFromEnv = () => {
  try {
    const env = resolveBukowskiSupabaseEnv(import.meta.env);
    return createBukowskiSupabaseClient(env);
  } catch {
    return null;
  }
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [supabase] = useState(() => createSupabaseClientFromEnv());
  const [status, setStatus] = useState<SessionStatus>(() => (supabase ? "loading" : "authenticated"));
  const [user, setUser] = useState<BukowskiSessionUser | null>(() =>
    supabase
      ? null
      : {
          id: "user-ops",
          email: "local@bukowskios.dev",
          displayName: "Local operator",
        },
  );
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let isMounted = true;

    const hydrateSession = async () => {
      const storedTokens = await window.bukowskiAuth?.getStoredTokens();

      if (storedTokens?.accessToken && storedTokens.refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: storedTokens.accessToken,
          refresh_token: storedTokens.refreshToken,
        });

        if (error && isMounted) {
          setAuthError(error.message);
          await window.bukowskiAuth?.clearStoredTokens();
        }
      }

      return supabase.auth.getSession();
    };

    void hydrateSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        setAuthError(error.message);
      }

      setUser(data.session?.user ? toSessionUser(data.session.user) : null);
      setStatus(data.session?.user ? "authenticated" : "unauthenticated");

      if (data.session) {
        void window.bukowskiAuth?.setStoredTokens({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        });
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setUser(nextSession?.user ? toSessionUser(nextSession.user) : null);
      setStatus(nextSession?.user ? "authenticated" : "unauthenticated");
      setAuthError(null);

      void window.bukowskiAuth?.setStoredTokens({
        accessToken: nextSession?.access_token ?? null,
        refreshToken: nextSession?.refresh_token ?? null,
      });
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        setStatus("authenticated");
        return;
      }

      setAuthError(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
        throw error;
      }
    },
    [supabase],
  );

  const signInWithMagicLink = useCallback(
    async (email: string) => {
      if (!supabase) {
        setStatus("authenticated");
        return;
      }

      setAuthError(null);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: "bukowskios://auth/callback",
        },
      });

      if (error) {
        setAuthError(error.message);
        throw error;
      }
    },
    [supabase],
  );

  const signInWithOAuth = useCallback(
    async (provider: "google" | "github") => {
      if (!supabase) {
        setStatus("authenticated");
        return;
      }

      setAuthError(null);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: "bukowskios://auth/callback",
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        setAuthError(error.message);
        throw error;
      }

      if (data.url) {
        await window.bukowskiApp?.openExternal(data.url);
      }
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    setAuthError(null);

    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setAuthError(error.message);
        throw error;
      }
    }

    await window.bukowskiAuth?.clearStoredTokens();
    setUser(supabase ? null : { id: "user-ops", email: "local@bukowskios.dev", displayName: "Local operator" });
    setStatus(supabase ? "unauthenticated" : "authenticated");
  }, [supabase]);

  const handleAuthDeepLink = useCallback(
    async (url: string) => {
      if (!supabase) {
        return;
      }

      setAuthError(null);

      try {
        const parsedUrl = new URL(url);
        const code = parsedUrl.searchParams.get("code");

        if (!code) {
          return;
        }

        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setAuthError(error.message);
          throw error;
        }
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "The auth callback could not be processed.");
        throw error;
      }
    },
    [supabase],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      supabase,
      isSupabaseConfigured: Boolean(supabase),
      isLocalFallback: !supabase,
      authError,
      signInWithPassword,
      signInWithMagicLink,
      signInWithOAuth,
      signOut,
      handleAuthDeepLink,
    }),
    [authError, handleAuthDeepLink, signInWithMagicLink, signInWithOAuth, signInWithPassword, signOut, status, supabase, user],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return value;
};
