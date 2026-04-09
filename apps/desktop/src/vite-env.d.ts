/// <reference types="vite/client" />

import type { AppInfo } from "@contracts/ipc/types";

declare global {
  interface Window {
    bukowskiApp?: {
      getAppInfo: () => Promise<AppInfo>;
    };
  }
}

export {};
