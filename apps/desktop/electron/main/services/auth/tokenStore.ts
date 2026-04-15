import keytar from "keytar";

const serviceName = "bukowskiOS";
const refreshTokenAccount = "supabase-refresh-token";
const accessTokenAccount = "supabase-access-token";

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
    await Promise.all([
      keytar.deletePassword(serviceName, accessTokenAccount),
      keytar.deletePassword(serviceName, refreshTokenAccount),
    ]);
  },
});
