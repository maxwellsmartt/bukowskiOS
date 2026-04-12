import { useEffect, useRef } from "react";

type UseVisiblePollingOptions = {
  enabled?: boolean;
  intervalMs: number;
  runOnMount?: boolean;
};

const isWindowVisible = () => document.visibilityState === "visible" && document.hasFocus();

export const useVisiblePolling = (
  callback: () => void | Promise<void>,
  { enabled = true, intervalMs, runOnMount = true }: UseVisiblePollingOptions,
) => {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let intervalId = 0;

    const run = () => {
      if (!isWindowVisible()) {
        return;
      }

      void callbackRef.current();
    };

    const startInterval = () => {
      window.clearInterval(intervalId);
      intervalId = window.setInterval(run, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (isWindowVisible()) {
        run();
      }
    };

    if (runOnMount) {
      run();
    }

    startInterval();
    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs, runOnMount]);
};
