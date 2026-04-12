import { app, ipcMain, shell } from "electron";

import { ipcChannels } from "@contracts/ipc/channels";

type RegisterAppIpcOptions = {
  databasePath: string;
};

export const registerAppIpc = ({ databasePath }: RegisterAppIpcOptions) => {
  ipcMain.handle(ipcChannels.app.getInfo, () => ({
    appName: "bukowskiOS",
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    shellVersion: "foundation-v1",
    databasePath,
  }));
  ipcMain.handle(ipcChannels.app.openExternal, (_event, url: string) => shell.openExternal(url));
};
