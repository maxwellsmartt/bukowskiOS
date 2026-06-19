import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import type { AppRemoteSyncTombstone } from "@contracts";
import {
  applyCompositePullCursor,
  cursorFromRow,
  readCompositePullCursor,
  writeCompositePullCursor,
} from "@shared/lib/compositePullCursor";

import { immediatePullEvent, notifyWorkspaceDataChanged } from "./useWorkspaceDataRefresh";

const POLL_INTERVAL_MS = 20_000;
const BATCH_SIZE = 250;
const MAX_PAGES = 8;

const cursorKey = (workspaceId: string) => `bukowski:sync-tombstone-pull-cursor:${workspaceId}:v1`;

export const useSyncTombstonePull = () => {
  const { supabase, isLocalFallback, status } = useSession();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const inFlightRef = useRef(false);
  const rerunRequestedRef = useRef(false);

  useEffect(() => {
    if (
      !supabase ||
      isLocalFallback ||
      status !== "authenticated" ||
      !isWorkspaceReady ||
      !activeWorkspaceId ||
      !window.bukowskiApp?.applyRemoteSyncTombstones
    ) {
      return undefined;
    }

    const runOnce = async () => {
      if (inFlightRef.current) {
        rerunRequestedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      let appliedAny = false;

      try {
        const key = cursorKey(activeWorkspaceId);
        let cursor = readCompositePullCursor(key);
        for (let page = 0; page < MAX_PAGES; page += 1) {
          let query = (supabase as any)
            .from("sync_tombstones")
            .select("workspace_id,table_name,entity_id,deleted_at,cursor_key")
            .eq("workspace_id", activeWorkspaceId)
            .order("deleted_at", { ascending: true })
            .order("cursor_key", { ascending: true })
            .limit(BATCH_SIZE);
          query = applyCompositePullCursor(query, cursor, "deleted_at", "cursor_key");
          const { data, error } = await query;
          if (error) {
            console.warn("[sync-tombstone-pull] Pull failed", error);
            break;
          }

          const rawRows = (data ?? []) as Array<Record<string, unknown>>;
          if (!rawRows.length) break;
          const rows = rawRows.map((row) => ({
            workspace_id: String(row.workspace_id),
            table_name: String(row.table_name),
            entity_id: String(row.entity_id),
            deleted_at: String(row.deleted_at),
          })) satisfies AppRemoteSyncTombstone[];
          const result = await window.bukowskiApp!.applyRemoteSyncTombstones({
            workspaceId: activeWorkspaceId,
            rows,
          });
          if (result.appliedCount > 0) appliedAny = true;
          if (result.errors.length > 0) {
            console.warn("[sync-tombstone-pull] Apply had errors", result.errors);
            break;
          }
          const nextCursor = cursorFromRow(rawRows[rawRows.length - 1], "deleted_at", "cursor_key");
          if (!nextCursor) break;
          cursor = nextCursor;
          writeCompositePullCursor(key, cursor);
          if (rawRows.length < BATCH_SIZE) break;
        }

        if (appliedAny) {
          notifyWorkspaceDataChanged({ source: "sync", entities: ["deletions"] });
        }
      } catch (error) {
        console.warn("[sync-tombstone-pull] Pull pass failed", error);
      } finally {
        inFlightRef.current = false;
        if (rerunRequestedRef.current) {
          rerunRequestedRef.current = false;
          void runOnce();
        }
      }
    };

    void runOnce();
    const onImmediatePull = () => void runOnce();
    window.addEventListener(immediatePullEvent, onImmediatePull);
    const interval = window.setInterval(() => void runOnce(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(immediatePullEvent, onImmediatePull);
    };
  }, [activeWorkspaceId, isLocalFallback, isWorkspaceReady, status, supabase]);
};
