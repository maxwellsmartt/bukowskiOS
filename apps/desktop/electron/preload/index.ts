import { contextBridge, ipcRenderer } from "electron";

import { ipcChannels } from "@contracts/ipc/channels";
import type { AppInfo } from "@contracts/ipc/types";

const bukowskiApp = {
  getAppInfo: () => ipcRenderer.invoke(ipcChannels.app.getInfo) as Promise<AppInfo>,
};

contextBridge.exposeInMainWorld("bukowskiApp", bukowskiApp);
