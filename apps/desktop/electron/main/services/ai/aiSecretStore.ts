import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

const secretFileName = "bukowski-ai-secrets.json";

type SecretManifest = Record<string, string>;

const getSecretFilePath = () => path.join(app.getPath("userData"), secretFileName);

const loadManifest = (): SecretManifest => {
  const filePath = getSecretFilePath();

  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as SecretManifest;
  } catch {
    return {};
  }
};

const saveManifest = (manifest: SecretManifest) => {
  fs.writeFileSync(getSecretFilePath(), JSON.stringify(manifest, null, 2), "utf8");
};

const createSecretKey = (workspaceId: string, providerKey: string) => `${workspaceId}:${providerKey}`;

export const createAISecretStore = () => ({
  hasProviderSecret(workspaceId: string, providerKey: string) {
    const manifest = loadManifest();
    return Boolean(manifest[createSecretKey(workspaceId, providerKey)]);
  },

  getProviderSecret(workspaceId: string, providerKey: string) {
    const manifest = loadManifest();
    const encodedSecret = manifest[createSecretKey(workspaceId, providerKey)];

    if (!encodedSecret) {
      return null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local encryption is unavailable on this device.");
    }

    return safeStorage.decryptString(Buffer.from(encodedSecret, "base64"));
  },

  setProviderSecret(workspaceId: string, providerKey: string, secret: string) {
    const nextSecret = secret.trim();

    if (!nextSecret) {
      throw new Error("Provider secret is required.");
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local encryption is unavailable on this device.");
    }

    const manifest = loadManifest();
    manifest[createSecretKey(workspaceId, providerKey)] = safeStorage.encryptString(nextSecret).toString("base64");
    saveManifest(manifest);
  },

  clearProviderSecret(workspaceId: string, providerKey: string) {
    const manifest = loadManifest();
    delete manifest[createSecretKey(workspaceId, providerKey)];
    saveManifest(manifest);
  },
});

export type AISecretStore = ReturnType<typeof createAISecretStore>;
