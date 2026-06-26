import { app } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("avatar-cache-store");

// A resolved avatar data URL is small (uploads are capped at 2 MB), but keep a
// generous ceiling so an unexpectedly large payload can never wedge the cache.
const MAX_DATA_URL_BYTES = 8 * 1024 * 1024;

const cacheDirectory = () => path.join(app.getPath("userData"), "avatar-cache");

const cacheFilePath = (userId: string) => {
  // The user id is a Supabase UUID; hash it so the on-disk name is always a
  // fixed-length, filesystem-safe token regardless of the id format.
  const token = createHash("sha256").update(userId).digest("hex");
  return path.join(cacheDirectory(), `${token}.dataurl`);
};

/**
 * Durable, offline-first avatar cache. Unlike the renderer's localStorage copy,
 * this survives storage clears and partition changes, so a resolved avatar keeps
 * rendering instantly on a cold start instead of flickering back to initials.
 */
export const readStoredAvatar = (userId: string): string | null => {
  if (!userId) return null;
  try {
    const filePath = cacheFilePath(userId);
    if (!fs.existsSync(filePath)) return null;
    const value = fs.readFileSync(filePath, "utf8");
    return value.startsWith("data:") ? value : null;
  } catch (error) {
    logger.warn("Could not read the cached avatar.", error);
    return null;
  }
};

export const cacheAvatar = (userId: string, dataUrl: string): void => {
  if (!userId || !dataUrl.startsWith("data:")) return;
  if (Buffer.byteLength(dataUrl, "utf8") > MAX_DATA_URL_BYTES) return;
  try {
    fs.mkdirSync(cacheDirectory(), { recursive: true });
    fs.writeFileSync(cacheFilePath(userId), dataUrl, "utf8");
  } catch (error) {
    logger.warn("Could not persist the avatar locally.", error);
  }
};

export const clearStoredAvatar = (userId: string): void => {
  if (!userId) return;
  try {
    const filePath = cacheFilePath(userId);
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  } catch (error) {
    logger.warn("Could not clear the cached avatar.", error);
  }
};
