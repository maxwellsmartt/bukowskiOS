import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { writePrivateFile } from "../../security/storagePrivacy";

const secretFileName = "bukowski-ai-secrets.json";

type SecretManifest = Record<string, string>;

let manifestCache: SecretManifest | null = null;
let encryptionAvailableCache: boolean | null = null;
const decryptedSecretCache = new Map<string, string>();

const getSecretFilePath = () => path.join(app.getPath("userData"), secretFileName);

const isEncryptionAvailable = () => {
  if (encryptionAvailableCache == null) {
    encryptionAvailableCache = safeStorage.isEncryptionAvailable();
  }

  return encryptionAvailableCache;
};

const loadManifest = (): SecretManifest => {
  if (manifestCache) {
    return { ...manifestCache };
  }

  const filePath = getSecretFilePath();

  if (!fs.existsSync(filePath)) {
    manifestCache = {};
    return {};
  }

  try {
    manifestCache = JSON.parse(fs.readFileSync(filePath, "utf8")) as SecretManifest;
    return { ...manifestCache };
  } catch {
    manifestCache = {};
    return {};
  }
};

const saveManifest = (manifest: SecretManifest) => {
  manifestCache = { ...manifest };
  writePrivateFile(getSecretFilePath(), JSON.stringify(manifest, null, 2), "utf8");
};

const getCachedSecret = (secretKey: string, encodedSecret: string) => {
  const cached = decryptedSecretCache.get(secretKey);
  if (cached) {
    return cached;
  }

  if (!isEncryptionAvailable()) {
    throw new Error("Secure local encryption is unavailable on this device.");
  }

  const decrypted = safeStorage.decryptString(Buffer.from(encodedSecret, "base64"));
  decryptedSecretCache.set(secretKey, decrypted);
  return decrypted;
};

const createSecretKey = (workspaceId: string, providerKey: string) => `${workspaceId}:${providerKey}`;
const createConnectorSecretKey = (workspaceId: string, connectorKey: string) => `${workspaceId}:connector:${connectorKey}`;

export type AISecretStore = {
  hasProviderSecret: (workspaceId: string, providerKey: string) => boolean;
  getProviderSecret: (workspaceId: string, providerKey: string) => string | null;
  setProviderSecret: (workspaceId: string, providerKey: string, secret: string) => void;
  clearProviderSecret: (workspaceId: string, providerKey: string) => void;
};

export type ConnectorSecretStore = AISecretStore & {
  hasConnectorSecret: (workspaceId: string, connectorKey: string) => boolean;
  getConnectorSecret: (workspaceId: string, connectorKey: string) => string | null;
  setConnectorSecret: (workspaceId: string, connectorKey: string, secret: string) => void;
  clearConnectorSecret: (workspaceId: string, connectorKey: string) => void;
};

export const createAISecretStore = (): ConnectorSecretStore => ({
  hasProviderSecret(workspaceId: string, providerKey: string) {
    if (!isEncryptionAvailable()) {
      return false;
    }

    const manifest = loadManifest();
    return Boolean(manifest[createSecretKey(workspaceId, providerKey)]);
  },

  getProviderSecret(workspaceId: string, providerKey: string) {
    const manifest = loadManifest();
    const secretKey = createSecretKey(workspaceId, providerKey);
    const encodedSecret = manifest[secretKey];

    if (!encodedSecret) {
      return null;
    }

    return getCachedSecret(secretKey, encodedSecret);
  },

  setProviderSecret(workspaceId: string, providerKey: string, secret: string) {
    const nextSecret = secret.trim();

    if (!nextSecret) {
      throw new Error("Provider secret is required.");
    }

    if (!isEncryptionAvailable()) {
      throw new Error("Secure local encryption is unavailable on this device.");
    }

    const manifest = loadManifest();
    const secretKey = createSecretKey(workspaceId, providerKey);
    manifest[secretKey] = safeStorage.encryptString(nextSecret).toString("base64");
    decryptedSecretCache.set(secretKey, nextSecret);
    saveManifest(manifest);
  },

  clearProviderSecret(workspaceId: string, providerKey: string) {
    const manifest = loadManifest();
    const secretKey = createSecretKey(workspaceId, providerKey);
    delete manifest[secretKey];
    decryptedSecretCache.delete(secretKey);
    saveManifest(manifest);
  },

  hasConnectorSecret(workspaceId: string, connectorKey: string) {
    if (!isEncryptionAvailable()) {
      return false;
    }

    const manifest = loadManifest();
    return Boolean(manifest[createConnectorSecretKey(workspaceId, connectorKey)]);
  },

  getConnectorSecret(workspaceId: string, connectorKey: string) {
    const manifest = loadManifest();
    const secretKey = createConnectorSecretKey(workspaceId, connectorKey);
    const encodedSecret = manifest[secretKey];

    if (!encodedSecret) {
      return null;
    }

    return getCachedSecret(secretKey, encodedSecret);
  },

  setConnectorSecret(workspaceId: string, connectorKey: string, secret: string) {
    const nextSecret = secret.trim();

    if (!nextSecret) {
      throw new Error("Connector secret is required.");
    }

    if (!isEncryptionAvailable()) {
      throw new Error("Secure local encryption is unavailable on this device.");
    }

    const manifest = loadManifest();
    const secretKey = createConnectorSecretKey(workspaceId, connectorKey);
    manifest[secretKey] = safeStorage.encryptString(nextSecret).toString("base64");
    decryptedSecretCache.set(secretKey, nextSecret);
    saveManifest(manifest);
  },

  clearConnectorSecret(workspaceId: string, connectorKey: string) {
    const manifest = loadManifest();
    const secretKey = createConnectorSecretKey(workspaceId, connectorKey);
    delete manifest[secretKey];
    decryptedSecretCache.delete(secretKey);
    saveManifest(manifest);
  },
});
