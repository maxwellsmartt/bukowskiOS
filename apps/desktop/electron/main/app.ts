import { app, BrowserWindow, Menu } from "electron";

import { registerAppIpc } from "./ipc/registerAppIpc";
import { buildAppMenu } from "./menus/buildAppMenu";
import { getDesktopEnvironment } from "./services/appEnvironment";
import { createMainWindow } from "./windows/createMainWindow";

const { devServerUrl, preloadPath, rendererDist } = getDesktopEnvironment(import.meta.url);

const createAppWindow = () =>
  createMainWindow({
    devServerUrl,
    preloadPath,
    rendererDist,
  });

app.whenReady().then(() => {
  registerAppIpc();
  Menu.setApplicationMenu(buildAppMenu());
  createAppWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
