import path from "node:path";
import { fileURLToPath } from "node:url";

export const getDesktopEnvironment = (moduleUrl: string) => {
  const currentDir = path.dirname(fileURLToPath(moduleUrl));
  const appRoot = path.join(currentDir, "../../..");

  return {
    appRoot,
    rendererDist: path.join(appRoot, "dist"),
    preloadPath: path.join(currentDir, "../preload/index.mjs"),
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
  };
};
