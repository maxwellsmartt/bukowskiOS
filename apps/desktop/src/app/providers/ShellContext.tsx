import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AppInfo } from "@contracts/ipc/types";

type ShellContextValue = {
  appInfo: AppInfo | null;
  workspaceName: string;
  projectScope: string;
  syncLabel: string;
};

const ShellContext = createContext<ShellContextValue | null>(null);

type ShellContextProviderProps = {
  children: ReactNode;
};

export const ShellContextProvider = ({ children }: ShellContextProviderProps) => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!window.bukowskiApp) {
        return;
      }

      try {
        setAppInfo(await window.bukowskiApp.getAppInfo());
      } catch {
        setAppInfo(null);
      }
    };

    void load();
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      appInfo,
      workspaceName: "Metadata Cine",
      projectScope: "Global / Cam B / April slate",
      syncLabel: "Local-first",
    }),
    [appInfo],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
};

export const useShellContext = () => {
  const value = useContext(ShellContext);

  if (!value) {
    throw new Error("useShellContext must be used within ShellContextProvider");
  }

  return value;
};
