import { z } from "zod";

import { ipcChannels } from "@contracts/ipc/channels";

import {
  cacheAvatar as persistStoredAvatar,
  clearStoredAvatar,
  readStoredAvatar,
} from "../services/auth/avatarCacheStore";
import {
  clearStoredSupabaseTokens,
  getFreshStoredAccessToken,
  setStoredSupabaseTokens,
  updateSupabaseUser,
} from "../services/auth/supabaseAuthBridge";
import type { StoredSupabaseTokens } from "../services/auth/tokenStore";
import { safeHandle, safeHandleReadWithSchema } from "./ipcSafeHandler";

const storedSupabaseTokensSchema = z.object({
  accessToken: z.string().nullable(),
  refreshToken: z.string().nullable(),
  remember: z.boolean().optional(),
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

const trustedAvatarOrigins = new Set([
  "https://lh3.googleusercontent.com",
  "https://avatars.githubusercontent.com",
  "https://secure.gravatar.com",
]);

// The configured Supabase project also serves user-uploaded avatars from its
// public storage bucket; trust that origin too so uploaded photos convert to a
// cacheable data URL (and therefore survive offline) just like OAuth avatars.
const supabaseStorageOrigin = (() => {
  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
})();
if (supabaseStorageOrigin) {
  trustedAvatarOrigins.add(supabaseStorageOrigin);
}

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
    ipcChannels.auth.getStoredAvatar,
    z.string().trim().min(1),
    (_event, userId) => readStoredAvatar(userId),
    "The app could not read the saved avatar.",
  );

  safeHandle(
    ipcChannels.auth.cacheAvatar,
    z.object({ userId: z.string().trim().min(1), dataUrl: z.string().trim().min(1) }),
    (_event, input) => {
      persistStoredAvatar(input.userId, input.dataUrl);
      return true;
    },
    "The app could not save the avatar locally.",
  );

  safeHandle(
    ipcChannels.auth.clearStoredAvatar,
    z.string().trim().min(1),
    (_event, userId) => {
      clearStoredAvatar(userId);
      return true;
    },
    "The app could not clear the saved avatar.",
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
    (_event, input: StoredSupabaseTokens & { remember?: boolean }) =>
      setStoredSupabaseTokens(
        { accessToken: input.accessToken, refreshToken: input.refreshToken },
        input.remember ?? true,
      ),
    "The app could not store the auth session.",
  );

  safeHandleReadWithSchema(
    ipcChannels.auth.clearStoredTokens,
    z.tuple([]),
    () => clearStoredSupabaseTokens(),
    "The app could not clear the auth session.",
  );
};
