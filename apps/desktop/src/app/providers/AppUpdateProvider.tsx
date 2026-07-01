import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AppUpdateStatus } from "@contracts";
import { useConnectivity } from "@shared/hooks/useConnectivity";

type AppUpdateContextValue = {
  status: AppUpdateStatus | null;
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  checkForUpdate: (force?: boolean) => Promise<AppUpdateStatus | null>;
  downloadUpdate: () => Promise<void>;
  openDownloadedUpdate: () => Promise<void>;
  revealDownloadedUpdate: () => Promise<void>;
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

const updatePollIntervalMs = 24 * 60 * 60 * 1000;

export const AppUpdateProvider = ({ children }: { children: ReactNode }) => {
  const isOnline = useConnectivity();
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!window.bukowskiApp) {
      return undefined;
    }

    let isMounted = true;
    void window.bukowskiApp.getAppUpdateStatus().then((nextStatus) => {
      if (isMounted) {
        setStatus(nextStatus);
      }
    }).catch(() => undefined);

    const unsubscribe = window.bukowskiApp.onAppUpdateStatus((nextStatus) => {
      if (isMounted) {
        setStatus(nextStatus);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const checkForUpdate = useCallback(async (force = false) => {
    if (!window.bukowskiApp) {
      return null;
    }
    const nextStatus = await window.bukowskiApp.checkForAppUpdate({ force });
    setStatus(nextStatus);
    return nextStatus;
  }, []);

  useEffect(() => {
    if (!window.bukowskiApp || !isOnline) {
      return undefined;
    }

    void checkForUpdate(false).catch(() => undefined);
    const interval = window.setInterval(() => {
      void checkForUpdate(false).catch(() => undefined);
    }, updatePollIntervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [checkForUpdate, isOnline]);

  const downloadUpdate = useCallback(async () => {
    if (!window.bukowskiApp) {
      return;
    }
    setIsModalOpen(true);
    const result = await window.bukowskiApp.downloadAppUpdate();
    setStatus(result.status);
  }, []);

  const openDownloadedUpdate = useCallback(async () => {
    if (!window.bukowskiApp) {
      return;
    }
    const result = await window.bukowskiApp.openDownloadedAppUpdate();
    setStatus(result.status);
  }, []);

  const revealDownloadedUpdate = useCallback(async () => {
    if (!window.bukowskiApp) {
      return;
    }
    const result = await window.bukowskiApp.revealDownloadedAppUpdate();
    setStatus(result.status);
  }, []);

  const value = useMemo<AppUpdateContextValue>(
    () => ({
      status,
      isModalOpen,
      openModal: () => setIsModalOpen(true),
      closeModal: () => setIsModalOpen(false),
      checkForUpdate,
      downloadUpdate,
      openDownloadedUpdate,
      revealDownloadedUpdate,
    }),
    [checkForUpdate, downloadUpdate, isModalOpen, openDownloadedUpdate, revealDownloadedUpdate, status],
  );

  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
};

export const useAppUpdate = () => {
  const context = useContext(AppUpdateContext);
  if (!context) {
    throw new Error("useAppUpdate must be used within AppUpdateProvider.");
  }
  return context;
};
