import { deleteSecret, readSecret, writeSecret } from "../../security/secureSecretFile";

const secretFileName = "bukowski-auth-tokens.json";
const refreshTokenAccount = "supabase-refresh-token";
const accessTokenAccount = "supabase-access-token";
const legacyServiceName = "bukowskiOS";
const isE2E = process.env.BUKOWSKI_E2E === "1";

let e2eTokens: StoredSupabaseTokens = {
  accessToken: null,
  refreshToken: null,
};

export type StoredSupabaseTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

const normalizeToken = (value: string | null | undefined) => {
  const token = value?.trim();
  return token ? token : null;
};

// One-time migration from the legacy keytar-backed tokens so an existing
// signed-in user is not logged out by the move to safeStorage. Fresh installs
// have no legacy tokens and never touch keytar.
const readLegacyKeytarTokens = async (): Promise<StoredSupabaseTokens> => {
  try {
    const { default: keytar } = await import("keytar");
    const [accessToken, refreshToken] = await Promise.all([
      keytar.getPassword(legacyServiceName, accessTokenAccount),
      keytar.getPassword(legacyServiceName, refreshTokenAccount),
    ]);
    return { accessToken: normalizeToken(accessToken), refreshToken: normalizeToken(refreshToken) };
  } catch {
    return { accessToken: null, refreshToken: null };
  }
};

// In-memory tokens for the current app run. When the user did NOT check
// "Keep me signed in" we keep the session only here — it works for this run
// but disappears on restart because nothing is written to disk.
let memoryTokens: StoredSupabaseTokens | null = null;
// Whether token writes should persist to disk. Set by setTokens({ persist });
// later refresh-driven writes (which pass no flag) inherit the current mode.
let persistMode = true;

export const createSupabaseTokenStore = () => ({
  async getTokens(): Promise<StoredSupabaseTokens> {
    if (isE2E) {
      return e2eTokens;
    }

    if (memoryTokens) {
      return memoryTokens;
    }

    const accessToken = normalizeToken(readSecret(secretFileName, accessTokenAccount));
    const refreshToken = normalizeToken(readSecret(secretFileName, refreshTokenAccount));
    if (accessToken || refreshToken) {
      return { accessToken, refreshToken };
    }

    // Migrate legacy keytar tokens into safeStorage once.
    const legacy = await readLegacyKeytarTokens();
    if (legacy.accessToken || legacy.refreshToken) {
      writeSecret(secretFileName, accessTokenAccount, legacy.accessToken);
      writeSecret(secretFileName, refreshTokenAccount, legacy.refreshToken);
    }
    return legacy;
  },

  async setTokens(tokens: StoredSupabaseTokens, options?: { persist?: boolean }): Promise<void> {
    const accessToken = normalizeToken(tokens.accessToken);
    const refreshToken = normalizeToken(tokens.refreshToken);

    if (isE2E) {
      e2eTokens = { accessToken, refreshToken };
      return;
    }

    if (options?.persist !== undefined) {
      persistMode = options.persist;
    }

    // Always keep the current-run copy so the session works immediately.
    memoryTokens = accessToken || refreshToken ? { accessToken, refreshToken } : null;

    if (persistMode) {
      writeSecret(secretFileName, accessTokenAccount, accessToken);
      writeSecret(secretFileName, refreshTokenAccount, refreshToken);
    } else {
      // Session-only: make sure nothing survives the next launch.
      deleteSecret(secretFileName, accessTokenAccount);
      deleteSecret(secretFileName, refreshTokenAccount);
    }
  },

  async clearTokens(): Promise<void> {
    memoryTokens = null;
    if (isE2E) {
      e2eTokens = { accessToken: null, refreshToken: null };
      return;
    }

    deleteSecret(secretFileName, accessTokenAccount);
    deleteSecret(secretFileName, refreshTokenAccount);
  },
});
