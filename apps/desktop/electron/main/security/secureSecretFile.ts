import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

import { writePrivateFile } from "./storagePrivacy";

// A tiny secret store backed by Electron's safeStorage: secrets are encrypted
// with the OS-managed key (a SINGLE keychain entry shared by the whole app —
// the same one aiSecretStore uses) and written to a private JSON file in
// userData. Using safeStorage everywhere means a fresh install prompts for
// keychain access at most ONCE, instead of once per keytar item.

type SecretManifest = Record<string, string>;

const manifestCache = new Map<string, SecretManifest>();

const getFilePath = (fileName: string) => path.join(app.getPath("userData"), fileName);

export const isSecureStorageAvailable = () => safeStorage.isEncryptionAvailable();

const loadManifest = (fileName: string): SecretManifest => {
  const cached = manifestCache.get(fileName);
  if (cached) return { ...cached };

  const filePath = getFilePath(fileName);
  if (!fs.existsSync(filePath)) {
    manifestCache.set(fileName, {});
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as SecretManifest;
    manifestCache.set(fileName, parsed);
    return { ...parsed };
  } catch {
    manifestCache.set(fileName, {});
    return {};
  }
};

const saveManifest = (fileName: string, manifest: SecretManifest) => {
  manifestCache.set(fileName, { ...manifest });
  writePrivateFile(getFilePath(fileName), JSON.stringify(manifest, null, 2), "utf8");
};

/** Read and decrypt a secret. Returns null when absent or undecryptable. */
export const readSecret = (fileName: string, key: string): string | null => {
  const manifest = loadManifest(fileName);
  const encoded = manifest[key];
  if (!encoded) return null;
  if (!isSecureStorageAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
};

/** Encrypt and persist a secret (null/empty deletes it). */
export const writeSecret = (fileName: string, key: string, value: string | null): void => {
  const manifest = loadManifest(fileName);
  const trimmed = value?.trim();
  if (!trimmed) {
    if (key in manifest) {
      delete manifest[key];
      saveManifest(fileName, manifest);
    }
    return;
  }
  if (!isSecureStorageAvailable()) {
    throw new Error("Secure local encryption is unavailable on this device.");
  }
  manifest[key] = safeStorage.encryptString(trimmed).toString("base64");
  saveManifest(fileName, manifest);
};

export const deleteSecret = (fileName: string, key: string): void => writeSecret(fileName, key, null);
