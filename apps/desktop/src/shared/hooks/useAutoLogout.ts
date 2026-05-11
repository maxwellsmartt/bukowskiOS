import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useUserSetting } from "@shared/hooks/useUserSetting";
import { userSettingKeys } from "@shared/lib/userSettings";

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = ["mousedown", "keydown", "wheel", "touchstart"];

export const AUTO_LOGOUT_DISABLED = 0;
export const AUTO_LOGOUT_DEFAULT_MINUTES = AUTO_LOGOUT_DISABLED;

const normalize = (value: number | undefined): number =>
  Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : AUTO_LOGOUT_DISABLED;

/**
 * Auto-logout the current session after N minutes of user inactivity.
 *
 * The threshold is read from the synced `userSettings` store, so changes
 * made in Settings (or on another device, once realtime is wired up) take
 * effect immediately — no sign-out + sign-in required.
 */
export const useAutoLogout = () => {
  const { status, signOut } = useSession();
  const timerRef = useRef<number | null>(null);
  const [rawMinutes] = useUserSetting(userSettingKeys.autoLogoutInactivityMinutes);
  const minutes = normalize(rawMinutes);

  useEffect(() => {
    if (status !== "authenticated") {
      return undefined;
    }

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
  }, [minutes, signOut, status]);
};
