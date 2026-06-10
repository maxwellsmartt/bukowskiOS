import { randomBytes } from "node:crypto";

import { deleteSecret, readSecret, writeSecret } from "../../security/secureSecretFile";
import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("database-key-store");

const secretFileName = "bukowski-db-key.json";
const databaseKeyAccount = "local-database-key-v1";
const legacyServiceName = "bukowskiOS";
const isE2E = process.env.BUKOWSKI_E2E === "1";

const DATABASE_KEY_BYTES = 32;

let e2eDatabaseKey: string | null = null;

const normalizeStoredKey = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * The database key never opens with the wrong bytes — but safeStorage with the
 * wrong keychain entry (e.g. the app launched under a different name, so the
 * OS resolves a different "<name> Safe Storage" item) decrypts to garbage
 * WITHOUT throwing (AES-CBC has no MAC). Returning those bytes downstream
 * makes the database open fail as SQLITE_NOTADB and can drag startup into the
 * backup-restore recovery path even though the database file is perfectly
 * fine. This error keeps that failure mode loud, typed and non-destructive.
 */
export class DatabaseKeyIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseKeyIntegrityError";
  }
}

const keyServiceHint =
  'The OS keychain entry used by safeStorage is derived from the app name ("bukowskiOS Safe Storage"). ' +
  "If you are running the app under a different name (for example a dev shell started from another directory), " +
  "decryption silently yields garbage. Re-launch under the correct app name; do NOT delete or regenerate the key " +
  "or the local database.";

// Strict shape check: setKey always stores randomBytes(32).toString("base64"),
// so anything that is not canonical base64 for exactly 32 bytes is corruption
// (most likely a wrong-keychain decrypt), never a legitimate key.
const decodeDatabaseKey = (value: string): Buffer | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== DATABASE_KEY_BYTES) {
    return null;
  }

  if (decoded.toString("base64") !== value) {
    return null;
  }

  return decoded;
};

const readE2EFixedDatabaseKey = () => {
  const fixedKey = normalizeStoredKey(process.env.BUKOWSKI_E2E_DATABASE_KEY_BASE64);
  if (!fixedKey) {
    return null;
  }

  const decoded = decodeDatabaseKey(fixedKey);
  if (!decoded) {
    throw new DatabaseKeyIntegrityError(
      "BUKOWSKI_E2E_DATABASE_KEY_BASE64 is set but is not base64 for exactly 32 bytes.",
    );
  }

  return decoded;
};

const generateDatabaseKey = () => randomBytes(DATABASE_KEY_BYTES);

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
      const fixedKey = readE2EFixedDatabaseKey();
      if (fixedKey) {
        return fixedKey;
      }
      const normalized = normalizeStoredKey(e2eDatabaseKey);
      return normalized ? Buffer.from(normalized, "base64") : null;
    }

    const stored = normalizeStoredKey(readSecret(secretFileName, databaseKeyAccount));
    if (stored) {
      const decoded = decodeDatabaseKey(stored);
      if (!decoded) {
        // A stored-but-invalid secret means the manifest decrypted to garbage
        // (wrong keychain entry) or was tampered with. Returning it would send
        // unusable bytes to the SQLCipher open; returning null would let
        // ensureKey overwrite the manifest and orphan the database forever.
        // Fail loudly instead.
        logger.error("Stored database key failed validation; refusing to use it.", {
          secretLength: stored.length,
        });
        throw new DatabaseKeyIntegrityError(`The stored local database key is unreadable. ${keyServiceHint}`);
      }
      return decoded;
    }

    // Migrate a legacy keytar-stored key into safeStorage if present. A legacy
    // value that fails validation is ignored (with a warning) rather than
    // fatal: the safeStorage manifest is the source of truth, and keytar items
    // can linger from unrelated installs.
    const legacy = await readLegacyKeytarKey();
    if (legacy) {
      const decoded = decodeDatabaseKey(legacy);
      if (!decoded) {
        logger.warn("Legacy keytar database key failed validation; skipping migration.");
        return null;
      }
      writeSecret(secretFileName, databaseKeyAccount, legacy);
      return decoded;
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
      if (readE2EFixedDatabaseKey()) {
        return;
      }
      e2eDatabaseKey = encodedKey;
      return;
    }

    writeSecret(secretFileName, databaseKeyAccount, encodedKey);
  },

  async clearKey() {
    if (isE2E) {
      if (readE2EFixedDatabaseKey()) {
        return;
      }
      e2eDatabaseKey = null;
      return;
    }

    deleteSecret(secretFileName, databaseKeyAccount);
  },
});
