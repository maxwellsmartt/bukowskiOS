import { useEffect } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";

import { requestImmediatePull } from "./useWorkspaceDataRefresh";

const WORKSPACE_MEMBERSHIPS_CHANGED_EVENT = "bukowski:workspace-memberships-changed";
// Coalesce bursts (a multi-row push emits one event per row) into a single pull.
const COALESCE_MS = 250;

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
        // Workspace identity (name/avatar/currency/accent) is fetched by the
        // workspace provider, not the pull hooks — nudge it so renames and brand
        // changes from another machine appear instantly.
        if ((payload as { table?: string }).table === "workspaces") {
          window.dispatchEvent(new Event(WORKSPACE_MEMBERSHIPS_CHANGED_EVENT));
        }
        triggerPull();
      })
      .subscribe();

    return () => {
      if (coalesceTimer != null) {
        window.clearTimeout(coalesceTimer);
      }
      void Promise.resolve(supabase.removeChannel(channel));
    };
  }, [supabase, isLocalFallback, status, isWorkspaceReady, activeWorkspaceId]);
};
