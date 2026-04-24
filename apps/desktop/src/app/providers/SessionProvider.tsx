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
  isPasswordRecovery: boolean;
  authError: string | null;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signInWithOAuth: (provider: "google" | "github") => Promise<void>;
  signOut: () => Promise<void>;
  handleAuthDeepLink: (url: string) => Promise<string>;
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

const isNetworkAuthError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Failed to fetch") ||
    message.includes("Load failed") ||
    message.includes("NetworkError") ||
    message.includes("ERR_NAME_NOT_RESOLVED")
  );
};

const decodeJwtSegment = (segment: string) => {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(globalThis.atob(padded)) as Record<string, unknown>;
};

const buildCachedSessionUser = (accessToken: string | null | undefined): BukowskiSessionUser | null => {
  const token = accessToken?.trim();

  if (!token) {
    return null;
  }

  try {
    const [, payloadSegment] = token.split(".");

    if (!payloadSegment) {
      return null;
    }

    const payload = decodeJwtSegment(payloadSegment);
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : null;
    const userMetadata =
      payload.user_metadata && typeof payload.user_metadata === "object" && !Array.isArray(payload.user_metadata)
        ? (payload.user_metadata as Record<string, unknown>)
        : {};

    if (!userId) {
      return null;
    }

    return toSessionUser({
      id: userId,
      email,
      user_metadata: userMetadata,
    });
  } catch {
    return null;
  }
};

const persistStoredTokens = (tokens: { accessToken: string | null; refreshToken: string | null }) => {
  void window.bukowskiAuth?.setStoredTokens(tokens).catch((error) => {
    console.warn("Unable to persist the Supabase session locally.", error);
  });
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
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let isMounted = true;

    const hydrateSession = async () => {
      const storedTokens = await window.bukowskiAuth?.getStoredTokens();
      const cachedUser = buildCachedSessionUser(storedTokens?.accessToken);

      if (cachedUser && isMounted) {
        setUser(cachedUser);
        setStatus("authenticated");
      }

      try {
        if (storedTokens?.accessToken && storedTokens.refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: storedTokens.accessToken,
            refresh_token: storedTokens.refreshToken,
          });

          if (error) {
            if (isNetworkAuthError(error) && cachedUser) {
              return {
                sessionUser: cachedUser,
                status: "authenticated" as const,
                authError: "Supabase no responde ahora mismo. Se cargó la sesión local en modo offline.",
                shouldPersistTokens: false,
              };
            }

            if (isMounted) {
              setAuthError(error.message);
              await window.bukowskiAuth?.clearStoredTokens();
            }
          }
        }

        const { data, error } = await supabase.auth.getSession();

        if (error) {
          if (isNetworkAuthError(error) && cachedUser) {
            return {
              sessionUser: cachedUser,
              status: "authenticated" as const,
              authError: "Supabase no responde ahora mismo. Se cargó la sesión local en modo offline.",
              shouldPersistTokens: false,
            };
          }

          return {
            sessionUser: null,
            status: "unauthenticated" as const,
            authError: error.message,
            shouldPersistTokens: false,
          };
        }

        return {
          sessionUser: data.session?.user ? toSessionUser(data.session.user) : null,
          status: data.session?.user ? ("authenticated" as const) : ("unauthenticated" as const),
          authError: null,
          shouldPersistTokens: Boolean(data.session),
          accessToken: data.session?.access_token ?? null,
          refreshToken: data.session?.refresh_token ?? null,
        };
      } catch (error) {
        if (isNetworkAuthError(error) && cachedUser) {
          return {
            sessionUser: cachedUser,
            status: "authenticated" as const,
            authError: "Supabase no responde ahora mismo. Se cargó la sesión local en modo offline.",
            shouldPersistTokens: false,
          };
        }

        return {
          sessionUser: null,
          status: "unauthenticated" as const,
          authError: error instanceof Error ? error.message : "Unable to restore the secure session.",
          shouldPersistTokens: false,
        };
      }
    };

    void hydrateSession()
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setUser(result.sessionUser);
        setStatus(result.status);
        setAuthError(result.authError);

        if (result.shouldPersistTokens) {
          persistStoredTokens({
            accessToken: result.accessToken ?? null,
            refreshToken: result.refreshToken ?? null,
          });
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setUser(null);
        setStatus("unauthenticated");
        setAuthError(error instanceof Error ? error.message : "Unable to restore the secure session.");
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setIsPasswordRecovery(event === "PASSWORD_RECOVERY");
      setUser(nextSession?.user ? toSessionUser(nextSession.user) : null);
      setStatus(nextSession?.user ? "authenticated" : "unauthenticated");
      setAuthError(null);

      persistStoredTokens({
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

  const requestPasswordReset = useCallback(
    async (email: string) => {
      if (!supabase) {
        throw new Error("Password recovery is unavailable in local-dev fallback mode.");
      }

      setAuthError(null);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "bukowskios://auth/callback?flow=password-recovery",
      });

      if (error) {
        setAuthError(error.message);
        throw error;
      }
    },
    [supabase],
  );

  const updatePassword = useCallback(
    async (password: string) => {
      if (!supabase) {
        throw new Error("Password update is unavailable in local-dev fallback mode.");
      }

      setAuthError(null);
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        setAuthError(error.message);
        throw error;
      }

      setIsPasswordRecovery(false);
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
    setIsPasswordRecovery(false);

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
        return "/";
      }

      setAuthError(null);

      try {
        const parsedUrl = new URL(url);
        const code = parsedUrl.searchParams.get("code");
        const flow = parsedUrl.searchParams.get("flow");
        const type = parsedUrl.searchParams.get("type");
        const isRecoveryFlow = flow === "password-recovery" || type === "recovery";

        if (!code) {
          return isRecoveryFlow ? "/login/reset-password" : "/workspaces/select";
        }

        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setAuthError(error.message);
          throw error;
        }

        setIsPasswordRecovery(isRecoveryFlow);
        return isRecoveryFlow ? "/login/reset-password" : "/workspaces/select";
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
      isPasswordRecovery,
      authError,
      signInWithPassword,
      signInWithMagicLink,
      requestPasswordReset,
      updatePassword,
      signInWithOAuth,
      signOut,
      handleAuthDeepLink,
    }),
    [
      authError,
      handleAuthDeepLink,
      isPasswordRecovery,
      requestPasswordReset,
      signInWithMagicLink,
      signInWithOAuth,
      signInWithPassword,
      signOut,
      status,
      supabase,
      updatePassword,
      user,
    ],
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
