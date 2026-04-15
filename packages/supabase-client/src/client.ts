import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { BukowskiDatabase } from "./types";

export type BukowskiSupabaseClient = SupabaseClient<BukowskiDatabase>;

export type BukowskiSupabaseEnv = {
  url: string;
  anonKey: string;
};

export type CreateBukowskiSupabaseClientOptions = {
  storage?: Storage;
  detectSessionInUrl?: boolean;
  persistSession?: boolean;
  autoRefreshToken?: boolean;
};

const normalizeEnvValue = (value: string | undefined) => value?.trim() ?? "";

export const resolveBukowskiSupabaseEnv = (env: Record<string, string | undefined>): BukowskiSupabaseEnv => {
  const url = normalizeEnvValue(env.VITE_SUPABASE_URL ?? env.SUPABASE_URL);
  const anonKey = normalizeEnvValue(env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY);

  if (!url || !anonKey) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  return { url, anonKey };
};

export const createBukowskiSupabaseClient = (
  env: BukowskiSupabaseEnv,
  options: CreateBukowskiSupabaseClientOptions = {},
): BukowskiSupabaseClient =>
  createClient<BukowskiDatabase>(env.url, env.anonKey, {
    auth: {
      flowType: "pkce",
      autoRefreshToken: options.autoRefreshToken ?? true,
      detectSessionInUrl: options.detectSessionInUrl ?? false,
      persistSession: options.persistSession ?? true,
      storage: options.storage,
    },
  });
