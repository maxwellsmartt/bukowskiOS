import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const getDesktopEnvironment = (moduleUrl: string) => {
  const currentDir = path.dirname(fileURLToPath(moduleUrl));
  const appRoot = path.join(currentDir, "..");
  const unpackedRendererDist = path.join(process.resourcesPath, "app.asar.unpacked", "dist");
  const rendererDist = fs.existsSync(path.join(unpackedRendererDist, "index.html"))
    ? unpackedRendererDist
    : path.join(appRoot, "dist");

  return {
    appRoot,
    rendererDist,
    preloadPath: path.join(currentDir, "index.mjs"),
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
  };
};
