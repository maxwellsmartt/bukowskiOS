import { useEffect, useState } from "react";

import { useConnectivity } from "@shared/hooks/useConnectivity";
import {
  parseRealtimeSyncStatusSnapshot,
  realtimeSyncStatusEvent,
  realtimeSyncStatusKey,
  type RealtimeSyncStatus,
  type RealtimeSyncStatusSnapshot,
} from "@shared/hooks/useRealtimeWorkspaceSync";
import { parseSyncTimestamp } from "@shared/lib/syncHealth";

const realtimeFreshWindowMs = 10 * 60 * 1_000;

const isFreshTimestamp = (value: string | null | undefined, windowMs: number) => {
  const timestamp = parseSyncTimestamp(value);
  return timestamp !== null && Date.now() - timestamp <= windowMs;
};

export type SyncConnectionTone = "live" | "degraded" | "offline" | "checking";

export type SyncConnectionState = {
  isOnline: boolean;
  realtimeStatus: RealtimeSyncStatus | null;
  hasFreshRealtimeEvidence: boolean;
  /** True when changes from other machines land here within a moment. */
  isLive: boolean;
  tone: SyncConnectionTone;
  lastEventAt: string | null;
};

/**
 * Shared read of the realtime connection layer (network online + Supabase
 * Realtime channel status + recent-event freshness). Both the top bar sync
 * control and the Sync mission-control page use this so "live / degraded /
 * offline" stays consistent. It is purely observational — the pulls do the work.
 */
export const useSyncConnectionState = (): SyncConnectionState => {
  const isOnline = useConnectivity();
  const [snapshot, setSnapshot] = useState<RealtimeSyncStatusSnapshot | null>(() => {
    try {
      return parseRealtimeSyncStatusSnapshot(window.localStorage.getItem(realtimeSyncStatusKey));
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handle = (event: Event) => {
      setSnapshot((event as CustomEvent<RealtimeSyncStatusSnapshot>).detail);
    };
    window.addEventListener(realtimeSyncStatusEvent, handle);
    return () => window.removeEventListener(realtimeSyncStatusEvent, handle);
  }, []);

  const realtimeStatus = snapshot?.status ?? null;
  const hasFreshRealtimeEvidence =
    isFreshTimestamp(snapshot?.confirmedAt, realtimeFreshWindowMs) ||
    isFreshTimestamp(snapshot?.lastEventAt, realtimeFreshWindowMs);

  const isLive = isOnline && (realtimeStatus === "SUBSCRIBED" || hasFreshRealtimeEvidence);

  const tone: SyncConnectionTone = !isOnline
    ? "offline"
    : isLive
      ? "live"
      : realtimeStatus === "CHANNEL_ERROR" || realtimeStatus === "TIMED_OUT"
        ? "degraded"
        : "checking";

  return {
    isOnline,
    realtimeStatus,
    hasFreshRealtimeEvidence,
    isLive,
    tone,
    lastEventAt: snapshot?.lastEventAt ?? null,
  };
};
