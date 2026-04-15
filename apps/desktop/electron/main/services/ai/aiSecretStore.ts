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
    if (!safeStorage.isEncryptionAvailable()) {
      return false;
    }

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

  hasConnectorSecret(workspaceId: string, connectorKey: string) {
    if (!safeStorage.isEncryptionAvailable()) {
      return false;
    }

    const manifest = loadManifest();
    return Boolean(manifest[createConnectorSecretKey(workspaceId, connectorKey)]);
  },

  getConnectorSecret(workspaceId: string, connectorKey: string) {
    const manifest = loadManifest();
    const encodedSecret = manifest[createConnectorSecretKey(workspaceId, connectorKey)];

    if (!encodedSecret) {
      return null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local encryption is unavailable on this device.");
    }

    return safeStorage.decryptString(Buffer.from(encodedSecret, "base64"));
  },

  setConnectorSecret(workspaceId: string, connectorKey: string, secret: string) {
    const nextSecret = secret.trim();

    if (!nextSecret) {
      throw new Error("Connector secret is required.");
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local encryption is unavailable on this device.");
    }

    const manifest = loadManifest();
    manifest[createConnectorSecretKey(workspaceId, connectorKey)] = safeStorage.encryptString(nextSecret).toString("base64");
    saveManifest(manifest);
  },

  clearConnectorSecret(workspaceId: string, connectorKey: string) {
    const manifest = loadManifest();
    delete manifest[createConnectorSecretKey(workspaceId, connectorKey)];
    saveManifest(manifest);
  },
});
