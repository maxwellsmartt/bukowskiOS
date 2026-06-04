import { randomBytes } from "node:crypto";

import keytar from "keytar";

const serviceName = "bukowskiOS";
const databaseKeyAccount = "local-database-key-v1";
const isE2E = process.env.BUKOWSKI_E2E === "1";

let e2eDatabaseKey: string | null = null;

const normalizeStoredKey = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const generateDatabaseKey = () => randomBytes(32);

export type LocalDatabaseKeyStore = {
  clearKey: () => Promise<void>;
  ensureKey: () => Promise<Buffer>;
  getKey: () => Promise<Buffer | null>;
  setKey: (key: Buffer) => Promise<void>;
};

export const createLocalDatabaseKeyStore = (): LocalDatabaseKeyStore => ({
  async getKey() {
    const encoded = isE2E ? e2eDatabaseKey : await keytar.getPassword(serviceName, databaseKeyAccount);
    const normalized = normalizeStoredKey(encoded);
    return normalized ? Buffer.from(normalized, "base64") : null;
  },

  async ensureKey() {
    const existing = await this.getKey();
    if (existing) {
      return existing;
    }

    const nextKey = generateDatabaseKey();
    await this.setKey(nextKey);
    return nextKey;
  },

  async setKey(key: Buffer) {
    const encodedKey = key.toString("base64");

    if (isE2E) {
      e2eDatabaseKey = encodedKey;
      return;
    }

    await keytar.setPassword(serviceName, databaseKeyAccount, encodedKey);
  },

  async clearKey() {
    if (isE2E) {
      e2eDatabaseKey = null;
      return;
    }

    await keytar.deletePassword(serviceName, databaseKeyAccount);
  },
});
