import { z } from "zod";

import { ipcChannels } from "@contracts/ipc/channels";

import { createSupabaseTokenStore, type StoredSupabaseTokens } from "../services/auth/tokenStore";
import { safeHandle, safeHandleReadWithSchema } from "./ipcSafeHandler";

const storedSupabaseTokensSchema = z.object({
  accessToken: z.string().nullable(),
  refreshToken: z.string().nullable(),
});

const tokenStore = createSupabaseTokenStore();

export const registerAuthIpc = () => {
  safeHandleReadWithSchema(
    ipcChannels.auth.getStoredTokens,
    z.tuple([]),
    () => tokenStore.getTokens(),
    "The app could not load the stored auth session.",
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
