import { useEffect } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";

import { requestImmediatePull } from "./useWorkspaceDataRefresh";

const WORKSPACE_MEMBERSHIPS_CHANGED_EVENT = "bukowski:workspace-memberships-changed";
export const realtimeSyncStatusEvent = "bukowski:realtime-sync-status";
export const realtimeSyncStatusKey = "bukowski:realtime-sync-status";
export type RealtimeSyncStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | "CONNECTING";
export type RealtimeSyncStatusSnapshot = {
  status: RealtimeSyncStatus;
  updatedAt: string;
  confirmedAt: string | null;
  lastEventAt: string | null;
};
// Coalesce bursts (a multi-row push emits one event per row) into a single pull.
// Keep this long enough for bulk asset/assignment sync batches to land without
// making the active view refresh dozens of times while an operator is still
// selecting or assigning equipment.
const COALESCE_MS = 1_200;
const SUBSCRIBE_TIMEOUT_MS = 8_000;

const isRealtimeStatus = (value: unknown): value is RealtimeSyncStatus =>
  value === "SUBSCRIBED" ||
  value === "CHANNEL_ERROR" ||
  value === "TIMED_OUT" ||
  value === "CLOSED" ||
  value === "CONNECTING";

export const parseRealtimeSyncStatusSnapshot = (rawValue: string | null): RealtimeSyncStatusSnapshot | null => {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<RealtimeSyncStatusSnapshot>;
    if (!isRealtimeStatus(parsed.status)) {
      return null;
    }

    return {
      status: parsed.status,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      confirmedAt: typeof parsed.confirmedAt === "string" ? parsed.confirmedAt : null,
      lastEventAt: typeof parsed.lastEventAt === "string" ? parsed.lastEventAt : null,
    };
  } catch {
    if (!isRealtimeStatus(rawValue)) {
      return null;
    }

    return {
      status: rawValue,
      updatedAt: new Date().toISOString(),
      confirmedAt: rawValue === "SUBSCRIBED" ? new Date().toISOString() : null,
      lastEventAt: null,
    };
  }
};

/**
 * Listens to Supabase Realtime for the whole `public` schema and, whenever any
 * row the current user can see changes, asks the background pull hooks to fetch
 * immediately instead of waiting for their next poll. This is what makes another
 * machine's edits land here within a moment, with no manual refresh.
 *
 * It is purely a low-latency *trigger*: the cursor-based pulls do the real work
 * and stay idempotent, and the periodic polls remain the safety net if Realtime
 * is unavailable (e.g. a table isn't in the `supabase_realtime` publication).
 */
export const useRealtimeWorkspaceSync = () => {
  const { supabase, isLocalFallback, status } = useSession();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();

  useEffect(() => {
    if (!supabase || isLocalFallback || status !== "authenticated" || !isWorkspaceReady || !activeWorkspaceId) {
      return undefined;
    }

    let coalesceTimer: number | null = null;
    let subscribeTimeout: number | null = null;
    let confirmedAt: string | null = null;
    let lastEventAt: string | null = null;
    const publishStatus = (nextStatus: RealtimeSyncStatus, { persist = true }: { persist?: boolean } = {}) => {
      const snapshot: RealtimeSyncStatusSnapshot = {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
        confirmedAt,
        lastEventAt,
      };
      try {
        if (persist) {
          window.localStorage.setItem(realtimeSyncStatusKey, JSON.stringify(snapshot));
        }
      } catch {
        // UI status remains available through the event when storage is unavailable.
      }
      window.dispatchEvent(new CustomEvent<RealtimeSyncStatusSnapshot>(realtimeSyncStatusEvent, { detail: snapshot }));
    };
    publishStatus("CONNECTING");
    subscribeTimeout = window.setTimeout(() => {
      publishStatus("TIMED_OUT");
    }, SUBSCRIBE_TIMEOUT_MS);
    const triggerPull = () => {
      if (coalesceTimer != null) {
        return;
      }
      coalesceTimer = window.setTimeout(() => {
        coalesceTimer = null;
        requestImmediatePull();
      }, COALESCE_MS);
    };

    const channel = supabase
      .channel(`workspace-sync:${activeWorkspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        const eventAt = new Date().toISOString();
        if (!confirmedAt) {
          confirmedAt = eventAt;
        }
        lastEventAt = eventAt;
        publishStatus("SUBSCRIBED");
        // Workspace identity (name/avatar/currency/accent) is fetched by the
        // workspace provider, not the pull hooks — nudge it so renames and brand
        // changes from another machine appear instantly.
        const table = (payload as { table?: string }).table;
        if (["workspaces", "workspace_memberships", "roles", "role_permissions", "permissions"].includes(table ?? "")) {
          window.dispatchEvent(new Event(WORKSPACE_MEMBERSHIPS_CHANGED_EVENT));
        }
        triggerPull();
      })
      .subscribe((nextStatus) => {
        if (nextStatus === "SUBSCRIBED") {
          confirmedAt = new Date().toISOString();
          if (subscribeTimeout != null) {
            window.clearTimeout(subscribeTimeout);
            subscribeTimeout = null;
          }
        }
        publishStatus(nextStatus as RealtimeSyncStatus);
        if (nextStatus === "SUBSCRIBED") {
          // Always catch up after a reconnect because events may have been
          // missed while the channel was unavailable.
          triggerPull();
        }
      });

    return () => {
      if (coalesceTimer != null) {
        window.clearTimeout(coalesceTimer);
      }
      if (subscribeTimeout != null) {
        window.clearTimeout(subscribeTimeout);
      }
      publishStatus("CLOSED", { persist: false });
      void Promise.resolve(supabase.removeChannel(channel));
    };
  }, [supabase, isLocalFallback, status, isWorkspaceReady, activeWorkspaceId]);
};
