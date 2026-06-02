import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createBukowskiSupabaseClient,
  resolveBukowskiSupabaseEnv,
  type BukowskiSupabaseClient,
} from "@bukowski/supabase-client";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export type BukowskiSessionUser = {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
};

type BukowskiUserProfile = {
  avatarUrl: string | null;
  email: string | null;
  fullName: string | null;
};

type SessionContextValue = {
  status: SessionStatus;
  user: BukowskiSessionUser | null;
  supabase: BukowskiSupabaseClient | null;
  isSupabaseConfigured: boolean;
  isLocalFallback: boolean;
  isPasswordRecovery: boolean;
  authError: string | null;
  updateUserMetadata: (data: Record<string, unknown>) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  requestFirstLoginLink: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signInWithOAuth: (provider: "google" | "github") => Promise<void>;
  signOut: () => Promise<void>;
  handleAuthDeepLink: (url: string) => Promise<string>;
  refreshUser: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const toSessionUser = (
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
  profile?: BukowskiUserProfile | null,
): BukowskiSessionUser => {
  const displayName =
    profile?.fullName?.trim() ||
    (typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : user.email ?? "BukowskiOS user");

  const avatarUrl =
    profile?.avatarUrl ||
    (typeof user.user_metadata?.avatar_url === "string" && user.user_metadata.avatar_url.length > 0
      ? user.user_metadata.avatar_url
      : null);

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    displayName,
    avatarUrl,
  };
};

const createSupabaseClientsFromEnv = () => {
  try {
    const env = resolveBukowskiSupabaseEnv(import.meta.env);
    return {
      authClient: createBukowskiSupabaseClient(env, {
        persistSession: false,
      }),
      dataClient: createBukowskiSupabaseClient(env, {
        accessToken: () => window.bukowskiAuth?.getAccessToken() ?? Promise.resolve(null),
        autoRefreshToken: false,
        persistSession: false,
      }),
    };
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

const loadUserProfile = async (supabase: BukowskiSupabaseClient, userId: string): Promise<BukowskiUserProfile | null> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const looseSupabase = supabase as any;
  const { data, error } = await looseSupabase
    .from("user_profiles")
    .select("avatar_url,email,full_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const profile = data as { avatar_url?: string | null; email?: string | null; full_name?: string | null };
  return {
    avatarUrl: profile.avatar_url ?? null,
    email: profile.email ?? null,
    fullName: profile.full_name ?? null,
  };
};

const resolveSessionUser = async (
  supabase: BukowskiSupabaseClient,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
) => {
  const sessionUser = toSessionUser(user, await loadUserProfile(supabase, user.id));
  if (!sessionUser.avatarUrl) {
    return sessionUser;
  }

  const avatarDataUrl = await window.bukowskiAuth?.getAvatarDataUrl(sessionUser.avatarUrl).catch(() => null);
  return avatarDataUrl ? { ...sessionUser, avatarUrl: avatarDataUrl } : sessionUser;
};

const acceptWorkspaceInvite = async (workspaceId: string | null) => {
  const env = resolveBukowskiSupabaseEnv(import.meta.env);
  const accessToken = await window.bukowskiAuth?.getAccessToken();

  if (!accessToken) {
    throw new Error("We could not verify your invite session. Open the invite link again or sign in first.");
  }

  const response = await fetch(`${env.url.replace(/\/+$/, "")}/functions/v1/accept-invite`, {
    method: "POST",
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workspaceId }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "We could not activate this workspace invite.");
  }
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [supabaseClients] = useState(() => createSupabaseClientsFromEnv());
  const authSupabase = supabaseClients?.authClient ?? null;
  const supabase = supabaseClients?.dataClient ?? null;
  const [status, setStatus] = useState<SessionStatus>(() => (supabaseClients ? "loading" : "authenticated"));
  const [user, setUser] = useState<BukowskiSessionUser | null>(() =>
    supabaseClients
      ? null
      : {
          id: "user-ops",
          email: "local@bukowskios.dev",
          displayName: "Local operator",
          avatarUrl: null,
        },
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!authSupabase || !supabase) {
      return undefined;
    }

    let isMounted = true;

    const hydrateSession = async () => {
      const storedAccessToken = await window.bukowskiAuth?.getAccessToken();
      const cachedUser = buildCachedSessionUser(storedAccessToken);

      if (cachedUser && isMounted) {
        setUser(cachedUser);
        setStatus("authenticated");
      }

      try {
        const { data, error } = await authSupabase.auth.getSession();

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
          sessionUser: data.session?.user
            ? await resolveSessionUser(supabase, data.session.user)
            : cachedUser,
          status: data.session?.user || cachedUser ? ("authenticated" as const) : ("unauthenticated" as const),
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
          authError: getUserFacingErrorMessage(error, "Unable to restore the secure session."),
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
        setAuthError(getUserFacingErrorMessage(error, "Unable to restore the secure session."));
      });

    const { data: listener } = authSupabase.auth.onAuthStateChange((event, nextSession) => {
      setIsPasswordRecovery(event === "PASSWORD_RECOVERY");
      persistStoredTokens({
        accessToken: nextSession?.access_token ?? null,
        refreshToken: nextSession?.refresh_token ?? null,
      });

      if (nextSession?.user) {
        setUser(toSessionUser(nextSession.user));
        void resolveSessionUser(supabase, nextSession.user).then(setUser).catch(() => {
          setUser(toSessionUser(nextSession.user));
        });
      } else {
        setUser(null);
      }
      setStatus(nextSession?.user ? "authenticated" : "unauthenticated");
      setAuthError(null);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [authSupabase, supabase]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!authSupabase) {
        setStatus("authenticated");
        return;
      }

      setAuthError(null);
      const { error } = await authSupabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
        throw error;
      }
    },
    [authSupabase],
  );

  const signInWithMagicLink = useCallback(
    async (email: string) => {
      if (!authSupabase) {
        setStatus("authenticated");
        return;
      }

      setAuthError(null);
      const { error } = await authSupabase.auth.signInWithOtp({
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
    [authSupabase],
  );

  const requestFirstLoginLink = useCallback(
    async (email: string) => {
      if (!authSupabase) {
        setStatus("authenticated");
        return;
      }

      setAuthError(null);
      const { error } = await authSupabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: "bukowskios://auth/callback?flow=first-login",
          shouldCreateUser: false,
        },
      });

      if (error) {
        setAuthError(error.message);
        throw error;
      }
    },
    [authSupabase],
  );

  const requestPasswordReset = useCallback(
    async (email: string) => {
      if (!authSupabase) {
        throw new Error("Password recovery is unavailable in local-dev fallback mode.");
      }

      setAuthError(null);
      const { error } = await authSupabase.auth.resetPasswordForEmail(email, {
        redirectTo: "bukowskios://auth/callback?flow=password-recovery",
      });

      if (error) {
        setAuthError(error.message);
        throw error;
      }
    },
    [authSupabase],
  );

  const updatePassword = useCallback(
    async (password: string) => {
      if (!supabase) {
        throw new Error("Password update is unavailable in local-dev fallback mode.");
      }

      setAuthError(null);
      if (!window.bukowskiAuth?.updateUser) {
        throw new Error("The secure auth bridge is unavailable.");
      }

      await window.bukowskiAuth.updateUser({
        password,
      });

      setIsPasswordRecovery(false);
    },
    [supabase],
  );

  const signInWithOAuth = useCallback(
    async (provider: "google" | "github") => {
      if (!authSupabase) {
        setStatus("authenticated");
        return;
      }

      setAuthError(null);
      const redirectTo = await window.bukowskiAuth?.getOAuthRedirectUrl().catch(() => null);
      const { data, error } = await authSupabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectTo ?? "bukowskios://auth/callback",
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
    [authSupabase],
  );

  const refreshUser = useCallback(async () => {
    if (!supabase) {
      return;
    }

    const cachedUser = buildCachedSessionUser(await window.bukowskiAuth?.getAccessToken());
    if (!cachedUser) {
      return;
    }
    setUser(await resolveSessionUser(supabase, cachedUser));
  }, [supabase]);

  const updateUserMetadata = useCallback(
    async (data: Record<string, unknown>) => {
      if (!supabase) {
        throw new Error("User profile updates are unavailable in local-dev fallback mode.");
      }

      if (!window.bukowskiAuth?.updateUser) {
        throw new Error("The secure auth bridge is unavailable.");
      }

      await window.bukowskiAuth.updateUser({ data });
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    setAuthError(null);
    setIsPasswordRecovery(false);

    if (authSupabase) {
      const { error } = await authSupabase.auth.signOut();
      if (error) {
        setAuthError(error.message);
        console.warn("Supabase sign out returned an error; clearing local session anyway.", error);
      }
    }

    await window.bukowskiAuth?.clearStoredTokens().catch((error) => {
      console.warn("Unable to clear stored auth tokens during sign out.", error);
    });
    setUser(
      supabase
        ? null
        : { id: "user-ops", email: "local@bukowskios.dev", displayName: "Local operator", avatarUrl: null },
    );
    setStatus(supabase ? "unauthenticated" : "authenticated");
  }, [authSupabase, supabase]);

  const handleAuthDeepLink = useCallback(
    async (url: string) => {
      if (!authSupabase || !supabase) {
        return "/";
      }

      setAuthError(null);

      try {
        const parsedUrl = new URL(url);
        const code = parsedUrl.searchParams.get("code");
        const flow = parsedUrl.searchParams.get("flow");
        const type = parsedUrl.searchParams.get("type");
        const isRecoveryFlow = flow === "password-recovery" || type === "recovery";
        const isFirstLoginFlow = flow === "first-login";
        const isInviteFlow = flow === "invite" || parsedUrl.pathname === "/accept-invite";
        const workspaceId = parsedUrl.searchParams.get("workspace_id") ?? parsedUrl.searchParams.get("workspaceId");

        if (!code) {
          return isRecoveryFlow || isFirstLoginFlow || isInviteFlow ? "/login/reset-password?mode=first-login" : "/workspaces/select";
        }

        const { data, error } = await authSupabase.auth.exchangeCodeForSession(code);
        if (error) {
          setAuthError(error.message);
          throw error;
        }

        if (data.session) {
          persistStoredTokens({
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
          });
          setUser(await resolveSessionUser(supabase, data.session.user));
          setStatus("authenticated");
        }

        if (isInviteFlow) {
          await acceptWorkspaceInvite(workspaceId);
          window.dispatchEvent(new CustomEvent("bukowski:workspace-memberships-changed"));
        }

        setIsPasswordRecovery(isRecoveryFlow || isFirstLoginFlow || isInviteFlow);
        return isRecoveryFlow || isFirstLoginFlow || isInviteFlow ? "/login/reset-password?mode=first-login" : "/workspaces/select";
      } catch (error) {
        setAuthError(getUserFacingErrorMessage(error, "The auth callback could not be processed."));
        throw error;
      }
    },
    [authSupabase, supabase],
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
      updateUserMetadata,
      signInWithPassword,
      signInWithMagicLink,
      requestFirstLoginLink,
      requestPasswordReset,
      updatePassword,
      signInWithOAuth,
      signOut,
      handleAuthDeepLink,
      refreshUser,
    }),
    [
      authError,
      handleAuthDeepLink,
      isPasswordRecovery,
      refreshUser,
      requestFirstLoginLink,
      requestPasswordReset,
      signInWithMagicLink,
      signInWithOAuth,
      signInWithPassword,
      signOut,
      status,
      supabase,
      updateUserMetadata,
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
