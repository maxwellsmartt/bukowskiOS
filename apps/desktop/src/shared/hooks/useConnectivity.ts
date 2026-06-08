import { useEffect, useState } from "react";

const PROBE_INTERVAL_MS = 20_000;
const PROBE_TIMEOUT_MS = 8_000;

// A lightweight reachability probe against the configured backend. We don't rely
// solely on navigator.onLine because Chromium's network notifier can get stuck
// (e.g. after sleep/network changes on macOS) and report offline while the box
// is actually online — the probe corrects that and detects recovery quickly.
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
const probeUrl = (() => {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, "");
  return base ? `${base}/auth/v1/health` : null;
})();

/**
 * Reports whether the renderer can actually reach the backend right now.
 * Reflects the data layer's real connectivity (which is what the sync/pull hooks
 * experience), not just the browser's online flag.
 */
export const useConnectivity = () => {
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (!probeUrl) {
        if (!cancelled) {
          setIsOnline(navigator.onLine);
        }
        return;
      }

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        // Send the anon key so the health endpoint returns 200 instead of 401 —
        // a 401 still proves reachability but Chromium logs it as a failed
        // resource every tick, which is just console noise. Any resolved
        // response means the round-trip succeeded; only a network failure throws.
        await fetch(probeUrl, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: supabaseAnonKey ? { apikey: supabaseAnonKey } : undefined,
        });
        if (!cancelled) {
          setIsOnline(true);
        }
      } catch {
        if (!cancelled) {
          setIsOnline(false);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), PROBE_INTERVAL_MS);

    const handleOnline = () => {
      setIsOnline(true);
      void check();
    };
    const handleOffline = () => setIsOnline(false);
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, []);

  return isOnline;
};
