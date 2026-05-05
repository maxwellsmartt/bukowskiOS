import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { readNumberPreference, uiPreferenceKeys } from "@shared/lib/preferences";

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = ["mousedown", "keydown", "wheel", "touchstart"];

export const AUTO_LOGOUT_DISABLED = 0;
export const AUTO_LOGOUT_DEFAULT_MINUTES = AUTO_LOGOUT_DISABLED;

const readInactivityMinutes = (): number => {
  const value = readNumberPreference(uiPreferenceKeys.autoLogoutInactivityMinutes, AUTO_LOGOUT_DEFAULT_MINUTES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : AUTO_LOGOUT_DISABLED;
};

/**
 * Auto-logout the current session after N minutes of user inactivity.
 * N is read from `uiPreferenceKeys.autoLogoutInactivityMinutes`. A value of 0
 * (or unset) disables the timer entirely. Resets on any pointer / keyboard
 * activity inside the document.
 */
export const useAutoLogout = () => {
  const { status, signOut } = useSession();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "authenticated") {
      return undefined;
    }

    const minutes = readInactivityMinutes();
    if (minutes === AUTO_LOGOUT_DISABLED) {
      return undefined;
    }

    const timeoutMs = minutes * 60_000;

    const armTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        void signOut();
      }, timeoutMs);
    };

    const handleActivity = () => {
      armTimer();
    };

    armTimer();

    for (const eventName of ACTIVITY_EVENTS) {
      document.addEventListener(eventName, handleActivity, { passive: true });
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      for (const eventName of ACTIVITY_EVENTS) {
        document.removeEventListener(eventName, handleActivity);
      }
    };
  }, [signOut, status]);
};
