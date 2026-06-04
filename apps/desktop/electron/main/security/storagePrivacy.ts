import fs from "node:fs";
import path from "node:path";

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

const canEnforcePermissions = () => process.platform !== "win32";

const safeChmod = (targetPath: string, mode: number) => {
  if (!canEnforcePermissions()) {
    return;
  }

  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // Best-effort hardening only.
  }
};

export const ensurePrivateDirectory = (directoryPath: string) => {
  fs.mkdirSync(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  safeChmod(directoryPath, PRIVATE_DIRECTORY_MODE);
  return directoryPath;
};

export const ensurePrivateFile = (filePath: string) => {
  safeChmod(filePath, PRIVATE_FILE_MODE);
  return filePath;
};

export const writePrivateFile = (filePath: string, data: Parameters<typeof fs.writeFileSync>[1], encoding?: BufferEncoding) => {
  ensurePrivateDirectory(path.dirname(filePath));
  if (encoding) {
    fs.writeFileSync(filePath, data, encoding);
  } else {
    fs.writeFileSync(filePath, data);
  }
  ensurePrivateFile(filePath);
  return filePath;
};
