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
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    center: true,
    resizable: true,
    movable: true,
    maximizable: true,
    fullscreenable: true,
    backgroundColor: "#0f1113",
    title: "bukowskiOS",
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

  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });

  return window;
};
