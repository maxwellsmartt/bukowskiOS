import { Buffer } from "node:buffer";

import { z } from "zod";

import { ipcChannels } from "@contracts/ipc/channels";

import { createSupabaseTokenStore, type StoredSupabaseTokens } from "../services/auth/tokenStore";
import { safeHandle, safeHandleReadWithSchema } from "./ipcSafeHandler";

const storedSupabaseTokensSchema = z.object({
  accessToken: z.string().nullable(),
  refreshToken: z.string().nullable(),
});
const updateUserSchema = z
  .object({
    password: z.string().min(6).max(256).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((input) => Boolean(input.password || input.data), {
    message: "A password or user metadata update is required.",
  });
const avatarUrlSchema = z.string().url();

const tokenStore = createSupabaseTokenStore();
const trustedAvatarOrigins = new Set([
  "https://lh3.googleusercontent.com",
  "https://avatars.githubusercontent.com",
  "https://secure.gravatar.com",
]);

const refreshSkewMs = 90_000;

const decodeJwtPayload = (accessToken: string): Record<string, unknown> | null => {
  const [, payload] = accessToken.split(".");
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const isAccessTokenFresh = (accessToken: string | null) => {
  if (!accessToken) {
    return false;
  }

  const payload = decodeJwtPayload(accessToken);
  const exp = typeof payload?.exp === "number" ? payload.exp : null;
  if (!exp) {
    return false;
  }

  return exp * 1000 > Date.now() + refreshSkewMs;
};

const getSupabaseAuthEnv = () => {
  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anonKey) {
    throw new Error("Supabase is not configured for secure auth token refresh.");
  }

  return { url, anonKey };
};

const refreshStoredTokens = async (tokens: StoredSupabaseTokens) => {
  if (!tokens.refreshToken) {
    return tokens.accessToken;
  }

  if (isAccessTokenFresh(tokens.accessToken)) {
    return tokens.accessToken;
  }

  const { url, anonKey } = getSupabaseAuthEnv();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ refresh_token: tokens.refreshToken }),
  });

  if (!response.ok) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      await tokenStore.clearTokens();
    }
    throw new Error("Stored Supabase session could not be refreshed.");
  }

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
  };
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : null;
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : tokens.refreshToken;

  if (!accessToken) {
    throw new Error("Supabase did not return a refreshed access token.");
  }

  await tokenStore.setTokens({ accessToken, refreshToken });
  return accessToken;
};

const getFreshStoredAccessToken = async () => refreshStoredTokens(await tokenStore.getTokens());

const updateSupabaseUser = async (input: z.infer<typeof updateUserSchema>) => {
  const accessToken = await getFreshStoredAccessToken();
  if (!accessToken) {
    throw new Error("An authenticated session is required to update this user.");
  }

  const { url, anonKey } = getSupabaseAuthEnv();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Supabase could not update the authenticated user.");
  }

  return response.json() as Promise<unknown>;
};

const fetchTrustedAvatarDataUrl = async (avatarUrl: string) => {
  const parsedUrl = new URL(avatarUrl);
  if (!trustedAvatarOrigins.has(parsedUrl.origin)) {
    return null;
  }

  const response = await fetch(parsedUrl);
  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > 2 * 1024 * 1024) {
    return null;
  }

  return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
};

type RegisterAuthIpcOptions = {
  getOAuthRedirectUrl?: () => string;
};

export const registerAuthIpc = (options: RegisterAuthIpcOptions = {}) => {
  safeHandleReadWithSchema(
    ipcChannels.auth.getAccessToken,
    z.tuple([]),
    () => getFreshStoredAccessToken(),
    "The app could not load the stored auth session.",
  );

  safeHandleReadWithSchema(
    ipcChannels.auth.getOAuthRedirectUrl,
    z.tuple([]),
    () => options.getOAuthRedirectUrl?.() ?? "bukowskios://auth/callback",
    "The app could not prepare the OAuth callback.",
  );

  safeHandle(
    ipcChannels.auth.getAvatarDataUrl,
    avatarUrlSchema,
    (_event, avatarUrl) => fetchTrustedAvatarDataUrl(avatarUrl),
    "The app could not prepare this avatar.",
  );

  safeHandle(
    ipcChannels.auth.updateUser,
    updateUserSchema,
    (_event, input) => updateSupabaseUser(input),
    "The app could not update this user.",
  );

  safeHandle(
    ipcChannels.auth.setStoredTokens,
    storedSupabaseTokensSchema,
    (_event, input: StoredSupabaseTokens) => tokenStore.setTokens(input),
    "The app could not store the auth session.",
  );

  safeHandleReadWithSchema(
    ipcChannels.auth.clearStoredTokens,
    z.tuple([]),
    () => tokenStore.clearTokens(),
    "The app could not clear the auth session.",
  );
};
