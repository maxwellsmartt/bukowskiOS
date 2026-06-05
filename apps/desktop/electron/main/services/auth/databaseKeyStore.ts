import { randomBytes } from "node:crypto";

import { deleteSecret, readSecret, writeSecret } from "../../security/secureSecretFile";

const secretFileName = "bukowski-db-key.json";
const databaseKeyAccount = "local-database-key-v1";
const legacyServiceName = "bukowskiOS";
const isE2E = process.env.BUKOWSKI_E2E === "1";

let e2eDatabaseKey: string | null = null;

const normalizeStoredKey = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const generateDatabaseKey = () => randomBytes(32);

// One-time migration: earlier builds stored the key in the OS keychain via
// keytar (a separate keychain item that prompted on first access). Read it once
// and move it into safeStorage so existing encrypted databases keep opening,
// then never touch keytar again. Fresh installs have no legacy key and skip
// this entirely (so they get a single safeStorage prompt at most).
const readLegacyKeytarKey = async (): Promise<string | null> => {
  try {
    const { default: keytar } = await import("keytar");
    return normalizeStoredKey(await keytar.getPassword(legacyServiceName, databaseKeyAccount));
  } catch {
    return null;
  }
};

export type LocalDatabaseKeyStore = {
  clearKey: () => Promise<void>;
  ensureKey: () => Promise<Buffer>;
  getKey: () => Promise<Buffer | null>;
  setKey: (key: Buffer) => Promise<void>;
};

export const createLocalDatabaseKeyStore = (): LocalDatabaseKeyStore => ({
  async getKey() {
    if (isE2E) {
      const normalized = normalizeStoredKey(e2eDatabaseKey);
      return normalized ? Buffer.from(normalized, "base64") : null;
    }

    const stored = normalizeStoredKey(readSecret(secretFileName, databaseKeyAccount));
    if (stored) {
      return Buffer.from(stored, "base64");
    }

    // Migrate a legacy keytar-stored key into safeStorage if present.
    const legacy = await readLegacyKeytarKey();
    if (legacy) {
      writeSecret(secretFileName, databaseKeyAccount, legacy);
      return Buffer.from(legacy, "base64");
    }

    return null;
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

    writeSecret(secretFileName, databaseKeyAccount, encodedKey);
  },

  async clearKey() {
    if (isE2E) {
      e2eDatabaseKey = null;
      return;
    }

    deleteSecret(secretFileName, databaseKeyAccount);
  },
});
