import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AppInfo, ShellBootstrap } from "@contracts";

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
  const [shellBootstrap, setShellBootstrap] = useState<ShellBootstrap | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!window.bukowskiApp || !window.bukowskiShell) {
        return;
      }

      try {
        const [nextAppInfo, nextShellBootstrap] = await Promise.all([
          window.bukowskiApp.getAppInfo(),
          window.bukowskiShell.getBootstrap(),
        ]);

        setAppInfo(nextAppInfo);
        setShellBootstrap(nextShellBootstrap);
      } catch {
        setAppInfo(null);
        setShellBootstrap(null);
      }
    };

    void load();
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      appInfo,
      workspaceName: shellBootstrap?.workspaceName ?? "bukowskiOS",
      projectScope: shellBootstrap?.projectScope ?? "Global",
      syncLabel: shellBootstrap?.syncLabel ?? "Local-first",
    }),
    [appInfo, shellBootstrap],
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
