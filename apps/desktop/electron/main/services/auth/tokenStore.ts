import keytar from "keytar";

const serviceName = "bukowskiOS";
const refreshTokenAccount = "supabase-refresh-token";
const accessTokenAccount = "supabase-access-token";
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

export const createSupabaseTokenStore = () => ({
  async getTokens(): Promise<StoredSupabaseTokens> {
    if (isE2E) {
      return e2eTokens;
    }

    const [accessToken, refreshToken] = await Promise.all([
      keytar.getPassword(serviceName, accessTokenAccount),
      keytar.getPassword(serviceName, refreshTokenAccount),
    ]);

    return {
      accessToken: normalizeToken(accessToken),
      refreshToken: normalizeToken(refreshToken),
    };
  },

  async setTokens(tokens: StoredSupabaseTokens): Promise<void> {
    const accessToken = normalizeToken(tokens.accessToken);
    const refreshToken = normalizeToken(tokens.refreshToken);

    if (isE2E) {
      e2eTokens = { accessToken, refreshToken };
      return;
    }

    await Promise.all([
      accessToken
        ? keytar.setPassword(serviceName, accessTokenAccount, accessToken)
        : keytar.deletePassword(serviceName, accessTokenAccount),
      refreshToken
        ? keytar.setPassword(serviceName, refreshTokenAccount, refreshToken)
        : keytar.deletePassword(serviceName, refreshTokenAccount),
    ]);
  },

  async clearTokens(): Promise<void> {
    if (isE2E) {
      e2eTokens = { accessToken: null, refreshToken: null };
      return;
    }

    await Promise.all([
      keytar.deletePassword(serviceName, accessTokenAccount),
      keytar.deletePassword(serviceName, refreshTokenAccount),
    ]);
  },
});
