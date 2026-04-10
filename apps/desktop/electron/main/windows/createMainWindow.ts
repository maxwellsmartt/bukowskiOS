import { BrowserWindow, shell } from "electron";
import path from "node:path";

import { bindWindowStatePersistence, getDefaultWindowBounds, readWindowState } from "./windowState";

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
  const savedWindowState = readWindowState();
  const fallbackBounds = getDefaultWindowBounds();
  const window = new BrowserWindow({
    width: savedWindowState?.bounds.width ?? fallbackBounds.width,
    height: savedWindowState?.bounds.height ?? fallbackBounds.height,
    x: savedWindowState?.bounds.x,
    y: savedWindowState?.bounds.y,
    minWidth: 880,
    minHeight: 600,
    show: false,
    center: !savedWindowState,
    resizable: true,
    movable: true,
    maximizable: true,
    fullscreenable: true,
    backgroundColor: "#0f1113",
    title: "bukowskiOS",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  bindWindowStatePersistence(window);

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
    if (savedWindowState?.isMaximized) {
      window.maximize();
    }
    window.show();
  });

  return window;
};
