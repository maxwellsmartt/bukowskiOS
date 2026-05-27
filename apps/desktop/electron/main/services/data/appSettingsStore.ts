import fs from "node:fs";
import path from "node:path";

import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("app-settings-store");

/**
 * Per-machine local app settings persisted as a small JSON file in userData.
 * NOT synced — these are machine-local preferences (e.g. where to store
 * documents, which can point at an iCloud/Drive folder so a single user's
 * machines share files). Default documents root is userData itself, so
 * existing behaviour is unchanged until the user picks a folder.
 */
export const createAppSettingsStore = (userDataPath: string) => {
  const file = path.join(userDataPath, "app-settings.json");

  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  const write = (data: Record<string, unknown>) => {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
      logger.warn("Failed to persist app settings.", { error: String(error) });
    }
  };

  return {
    /** Resolved documents root; falls back to userData when unset/invalid. */
    getDocumentsRoot: (): string => {
      const value = read().documentsRoot;
      if (typeof value === "string" && value.trim() && fs.existsSync(value)) return value;
      return userDataPath;
    },

    /** Raw stored value (null when using the default). */
    getDocumentsRootSetting: (): string | null => {
      const value = read().documentsRoot;
      return typeof value === "string" && value.trim() ? value : null;
    },

    setDocumentsRoot: (next: string | null) => {
      const data = read();
      if (next && next.trim()) data.documentsRoot = next.trim();
      else delete data.documentsRoot;
      write(data);
    },

    defaultDocumentsRoot: () => userDataPath,
  };
};

export type AppSettingsStore = ReturnType<typeof createAppSettingsStore>;
