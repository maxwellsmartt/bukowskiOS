import { Buffer } from "node:buffer";

import { createSupabaseTokenStore, type StoredSupabaseTokens } from "./tokenStore";

const refreshSkewMs = 90_000;
const tokenStore = createSupabaseTokenStore();

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

const readResponseMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof payload.error === "string") {
      return payload.error;
    }
    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // Fall back to status text when Supabase does not return JSON.
  }

  return response.statusText;
};

export const getFreshStoredAccessToken = async () => refreshStoredTokens(await tokenStore.getTokens());

export const setStoredSupabaseTokens = (tokens: StoredSupabaseTokens) => tokenStore.setTokens(tokens);

export const clearStoredSupabaseTokens = () => tokenStore.clearTokens();

export const updateSupabaseUser = async (input: { password?: string; data?: Record<string, unknown> }) => {
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
    throw new Error(`Supabase could not update the authenticated user: ${await readResponseMessage(response)}`);
  }

  return response.json() as Promise<unknown>;
};

export const invokeSupabaseEdgeFunction = async <TPayload>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<TPayload> => {
  const accessToken = await getFreshStoredAccessToken();
  if (!accessToken) {
    throw new Error("An authenticated session is required to complete this request.");
  }

  const { url, anonKey } = getSupabaseAuthEnv();
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${functionName} failed (${response.status}): ${await readResponseMessage(response)}`);
  }

  return response.json() as Promise<TPayload>;
};
