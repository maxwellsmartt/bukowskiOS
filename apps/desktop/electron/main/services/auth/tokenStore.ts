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

export const createSupabaseTokenStore = () => ({
  async getTokens(): Promise<StoredSupabaseTokens> {
    if (isE2E) {
      return e2eTokens;
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

  async setTokens(tokens: StoredSupabaseTokens): Promise<void> {
    const accessToken = normalizeToken(tokens.accessToken);
    const refreshToken = normalizeToken(tokens.refreshToken);

    if (isE2E) {
      e2eTokens = { accessToken, refreshToken };
      return;
    }

    writeSecret(secretFileName, accessTokenAccount, accessToken);
    writeSecret(secretFileName, refreshTokenAccount, refreshToken);
  },

  async clearTokens(): Promise<void> {
    if (isE2E) {
      e2eTokens = { accessToken: null, refreshToken: null };
      return;
    }

    deleteSecret(secretFileName, accessTokenAccount);
    deleteSecret(secretFileName, refreshTokenAccount);
  },
});
