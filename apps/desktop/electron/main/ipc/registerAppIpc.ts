import { app, ipcMain } from "electron";

import { ipcChannels } from "@contracts/ipc/channels";

export const registerAppIpc = () => {
  ipcMain.handle(ipcChannels.app.getInfo, () => ({
    appName: "BUKOWSKI",
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    shellVersion: "foundation-v1",
  }));
};
