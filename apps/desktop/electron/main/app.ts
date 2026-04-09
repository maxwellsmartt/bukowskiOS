import { app, BrowserWindow, Menu } from "electron";
import path from "node:path";

import { registerAppIpc } from "./ipc/registerAppIpc";
import { registerFoundationIpc } from "./ipc/registerFoundationIpc";
import { buildAppMenu } from "./menus/buildAppMenu";
import { getDesktopEnvironment } from "./services/appEnvironment";
import { initializeLocalDatabase } from "./services/data/localDatabase";
import { createMainWindow } from "./windows/createMainWindow";

const { devServerUrl, preloadPath, rendererDist } = getDesktopEnvironment(import.meta.url);

const createAppWindow = () =>
  createMainWindow({
    devServerUrl,
    preloadPath,
    rendererDist,
  });

app.setName("bukowskiOS");
app.setPath("userData", path.join(app.getPath("appData"), "@bukowski/desktop"));

app.whenReady().then(() => {
  const localDatabase = initializeLocalDatabase();

  registerAppIpc({ databasePath: localDatabase.databasePath });
  registerFoundationIpc({ foundationReads: localDatabase.foundationReads });
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
