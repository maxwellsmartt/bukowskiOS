import { Buffer } from "node:buffer";

import { createSupabaseTokenStore, type StoredSupabaseTokens } from "./tokenStore";

const refreshSkewMs = 90_000;
const tokenStore = createSupabaseTokenStore();
const imageExtensionByMime: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const userAvatarMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const workspaceImageMimeTypes = new Set([...userAvatarMimeTypes, "image/svg+xml"]);

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

const normalizeContentType = (value: string) => value.trim().toLowerCase().split(";")[0] ?? "";

const extensionFromFileName = (fileName: string) => {
  const extension = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "jpeg") {
    return "jpg";
  }
  return extension ?? null;
};

const assertTrustedImageUpload = (input: {
  bytes: ArrayBuffer;
  contentType: string;
  fileName: string;
  allowedMimeTypes: Set<string>;
  maxBytes: number;
}) => {
  const byteLength = input.bytes.byteLength;
  if (byteLength <= 0) {
    throw new Error("The selected image is empty.");
  }
  if (byteLength > input.maxBytes) {
    throw new Error("The selected image is too large.");
  }

  const contentType = normalizeContentType(input.contentType);
  const extension = extensionFromFileName(input.fileName);
  const expectedExtension = imageExtensionByMime[contentType] ?? null;
  const normalizedExtension = extension === "jpeg" ? "jpg" : extension;

  if (!input.allowedMimeTypes.has(contentType) || !expectedExtension) {
    throw new Error("The selected image format is not supported.");
  }

  if (normalizedExtension && normalizedExtension !== expectedExtension) {
    throw new Error("The selected image extension does not match its content type.");
  }

  return { contentType, extension: expectedExtension };
};

const encodeObjectPath = (objectPath: string) => objectPath.split("/").map(encodeURIComponent).join("/");

const publicStorageUrl = (supabaseUrl: string, bucket: string, objectPath: string) =>
  `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodeObjectPath(objectPath)}`;

export const getFreshStoredAccessToken = async () => refreshStoredTokens(await tokenStore.getTokens());

export const getFreshStoredUserId = async () => {
  const accessToken = await getFreshStoredAccessToken();
  const payload = accessToken ? decodeJwtPayload(accessToken) : null;
  const userId = typeof payload?.sub === "string" ? payload.sub : null;

  if (!userId) {
    throw new Error("An authenticated user is required to complete this request.");
  }

  return userId;
};

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

export const uploadSupabaseStorageObject = async (input: {
  bucket: "user-avatars" | "workspace-assets";
  objectPath: string;
  bytes: ArrayBuffer;
  contentType: string;
}) => {
  const accessToken = await getFreshStoredAccessToken();
  if (!accessToken) {
    throw new Error("An authenticated session is required to upload this file.");
  }

  const { url, anonKey } = getSupabaseAuthEnv();
  const response = await fetch(`${url}/storage/v1/object/${input.bucket}/${encodeObjectPath(input.objectPath)}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "cache-control": "max-age=3600",
      "content-type": input.contentType,
      "x-upsert": "true",
    },
    body: Buffer.from(input.bytes),
  });

  if (!response.ok) {
    throw new Error(`Storage upload failed (${response.status}): ${await readResponseMessage(response)}`);
  }

  return {
    objectPath: input.objectPath,
    publicUrl: publicStorageUrl(url, input.bucket, input.objectPath),
  };
};

export const uploadUserAvatarObject = async (input: {
  userId: string;
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
}) => {
  const { contentType, extension } = assertTrustedImageUpload({
    ...input,
    allowedMimeTypes: userAvatarMimeTypes,
    maxBytes: 2 * 1024 * 1024,
  });
  const objectPath = `${input.userId}/avatar-${Date.now()}.${extension}`;
  return uploadSupabaseStorageObject({
    bucket: "user-avatars",
    objectPath,
    bytes: input.bytes,
    contentType,
  });
};

export const uploadWorkspaceImageObject = async (input: {
  workspaceId: string;
  assetKind: "avatar" | "logo" | "seal" | "signature";
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
}) => {
  const { contentType, extension } = assertTrustedImageUpload({
    ...input,
    allowedMimeTypes: workspaceImageMimeTypes,
    maxBytes: 4 * 1024 * 1024,
  });
  const objectPath = `${input.workspaceId}/${input.assetKind}-${Date.now()}.${extension}`;
  return uploadSupabaseStorageObject({
    bucket: "workspace-assets",
    objectPath,
    bytes: input.bytes,
    contentType,
  });
};
