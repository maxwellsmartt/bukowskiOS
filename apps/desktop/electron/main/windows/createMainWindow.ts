import { BrowserWindow, shell } from "electron";
import path from "node:path";

type CreateMainWindowOptions = {
  devServerUrl?: string;
  preloadPath: string;
  rendererDist: string;
};

export const createMainWindow = ({
  devServerUrl,
  preloadPath,
  rendererDist,
}: CreateMainWindowOptions) => {
  const window = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1220,
    minHeight: 780,
    backgroundColor: "#111417",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (devServerUrl) {
    window.loadURL(devServerUrl);
  } else {
    window.loadFile(path.join(rendererDist, "index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
};
