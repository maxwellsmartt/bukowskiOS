import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the safeStorage-backed secret file. getKey must never
// see real safeStorage in tests; what matters is how it treats the decrypted
// value (valid key vs wrong-keychain garbage).
const secrets = new Map<string, string>();
const readSecret = vi.fn((_file: string, key: string) => secrets.get(key) ?? null);
const writeSecret = vi.fn((_file: string, key: string, value: string | null) => {
  if (value) {
    secrets.set(key, value);
  } else {
    secrets.delete(key);
  }
});
const deleteSecret = vi.fn((_file: string, key: string) => {
  secrets.delete(key);
});

vi.mock("../../electron/main/security/secureSecretFile", () => ({
  readSecret: (...args: [string, string]) => readSecret(...args),
  writeSecret: (...args: [string, string, string | null]) => writeSecret(...args),
  deleteSecret: (...args: [string, string]) => deleteSecret(...args),
  isSecureStorageAvailable: () => true,
}));

let keytarValue: string | null = null;
vi.mock("keytar", () => ({
  default: {
    getPassword: vi.fn(async () => keytarValue),
  },
}));

const SECRET_KEY = "local-database-key-v1";
const validKey = () => randomBytes(32).toString("base64");

// What a wrong-keychain safeStorage decrypt actually looks like: opaque bytes
// rendered as a string (observed live on 2026-06-10 — `{A` + mojibake).
const WRONG_KEYCHAIN_GARBAGE = "{Aï¿½Þ­Qkñâ·garbageÿ";

const importKeyStore = async () => {
  const module = await import("../../electron/main/services/auth/databaseKeyStore");
  return module;
};

describe("local database key store", () => {
  beforeEach(() => {
    secrets.clear();
    keytarValue = null;
    readSecret.mockClear();
    writeSecret.mockClear();
    deleteSecret.mockClear();
  });

  it("returns the stored key when it is canonical base64 for 32 bytes", async () => {
    const { createLocalDatabaseKeyStore } = await importKeyStore();
    const encoded = validKey();
    secrets.set(SECRET_KEY, encoded);

    const key = await createLocalDatabaseKeyStore().getKey();

    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
    expect(key!.toString("base64")).toBe(encoded);
  });

  it("throws DatabaseKeyIntegrityError when the stored secret is wrong-keychain garbage", async () => {
    const { createLocalDatabaseKeyStore, DatabaseKeyIntegrityError } = await importKeyStore();
    secrets.set(SECRET_KEY, WRONG_KEYCHAIN_GARBAGE);

    await expect(createLocalDatabaseKeyStore().getKey()).rejects.toBeInstanceOf(DatabaseKeyIntegrityError);
  });

  it("throws when the stored secret is valid base64 of the wrong length", async () => {
    const { createLocalDatabaseKeyStore, DatabaseKeyIntegrityError } = await importKeyStore();
    secrets.set(SECRET_KEY, randomBytes(16).toString("base64"));

    await expect(createLocalDatabaseKeyStore().getKey()).rejects.toBeInstanceOf(DatabaseKeyIntegrityError);
  });

  it("never overwrites a corrupt stored secret through ensureKey", async () => {
    const { createLocalDatabaseKeyStore, DatabaseKeyIntegrityError } = await importKeyStore();
    secrets.set(SECRET_KEY, WRONG_KEYCHAIN_GARBAGE);

    await expect(createLocalDatabaseKeyStore().ensureKey()).rejects.toBeInstanceOf(DatabaseKeyIntegrityError);
    expect(writeSecret).not.toHaveBeenCalled();
    expect(secrets.get(SECRET_KEY)).toBe(WRONG_KEYCHAIN_GARBAGE);
  });

  it("returns null when no key is stored anywhere", async () => {
    const { createLocalDatabaseKeyStore } = await importKeyStore();

    await expect(createLocalDatabaseKeyStore().getKey()).resolves.toBeNull();
  });

  it("migrates a valid legacy keytar key into the secret store", async () => {
    const { createLocalDatabaseKeyStore } = await importKeyStore();
    const encoded = validKey();
    keytarValue = encoded;

    const key = await createLocalDatabaseKeyStore().getKey();

    expect(key!.toString("base64")).toBe(encoded);
    expect(secrets.get(SECRET_KEY)).toBe(encoded);
  });

  it("ignores an invalid legacy keytar value instead of migrating it", async () => {
    const { createLocalDatabaseKeyStore } = await importKeyStore();
    keytarValue = "not-a-real-key";

    await expect(createLocalDatabaseKeyStore().getKey()).resolves.toBeNull();
    expect(secrets.has(SECRET_KEY)).toBe(false);
  });
});

describe("openOrMigrateEncryptedDatabase key guard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-key-guard-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("refuses to mint a fresh key for an existing encrypted database", async () => {
    const { DatabaseKeyIntegrityError } = await importKeyStore();
    const { openOrMigrateEncryptedDatabase } = await import(
      "../../electron/main/services/data/databaseEncryption"
    );

    // Any non-plaintext header reads as "already encrypted".
    const databasePath = path.join(tempDir, "encrypted.sqlite");
    fs.writeFileSync(databasePath, randomBytes(512));

    const ensureKey = vi.fn(async () => randomBytes(32));
    const keyStore = {
      getKey: vi.fn(async () => null),
      ensureKey,
      setKey: vi.fn(async () => undefined),
      clearKey: vi.fn(async () => undefined),
    };

    await expect(openOrMigrateEncryptedDatabase({ databasePath, keyStore })).rejects.toBeInstanceOf(
      DatabaseKeyIntegrityError,
    );
    expect(ensureKey).not.toHaveBeenCalled();
  });

  it("propagates key corruption errors from the store untouched", async () => {
    const { DatabaseKeyIntegrityError } = await importKeyStore();
    const { openOrMigrateEncryptedDatabase } = await import(
      "../../electron/main/services/data/databaseEncryption"
    );

    const databasePath = path.join(tempDir, "encrypted.sqlite");
    fs.writeFileSync(databasePath, randomBytes(512));

    const corruption = new DatabaseKeyIntegrityError("stored key is unreadable");
    const keyStore = {
      getKey: vi.fn(async () => {
        throw corruption;
      }),
      ensureKey: vi.fn(async () => randomBytes(32)),
      setKey: vi.fn(async () => undefined),
      clearKey: vi.fn(async () => undefined),
    };

    await expect(openOrMigrateEncryptedDatabase({ databasePath, keyStore })).rejects.toBe(corruption);
    expect(keyStore.ensureKey).not.toHaveBeenCalled();
  });
});
