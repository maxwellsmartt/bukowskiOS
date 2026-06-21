import { useEffect, useRef } from "react";

import type { AppRemoteWorkspaceFileRow } from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import {
  applyCompositePullCursor,
  canAdvanceCompositePullCursor,
  cursorFromRow,
  readCompositePullCursor,
  writeCompositePullCursor,
} from "@shared/lib/compositePullCursor";

import { immediatePullEvent, notifyWorkspaceDataChanged } from "./useWorkspaceDataRefresh";

const POLL_INTERVAL_MS = 60_000;
const PULL_BATCH_SIZE = 100;
const MAX_BATCHES_PER_PASS = 5;
const cursorKey = (workspaceId: string) => `bukowski:workspace-files-pull-cursor:${workspaceId}:v1`;

export const useWorkspaceFilePull = () => {
  const { supabase, isLocalFallback, status } = useSession();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const inFlightRef = useRef(false);
  const rerunRequestedRef = useRef(false);

  useEffect(() => {
    if (
      !supabase || isLocalFallback || status !== "authenticated" || !isWorkspaceReady
      || !activeWorkspaceId || !window.bukowskiApp?.applyRemoteWorkspaceFiles
    ) return undefined;

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
        for (let batch = 0; batch < MAX_BATCHES_PER_PASS; batch += 1) {
          let query = (supabase as any)
            .from("workspace_files")
            .select("*")
            .eq("workspace_id", activeWorkspaceId)
            .order("updated_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(PULL_BATCH_SIZE);
          query = applyCompositePullCursor(query, cursor, "updated_at", "id");
          const { data, error } = await query;
          if (error) {
            if ((error as { code?: string }).code !== "PGRST205") {
              console.warn("[workspace-file-pull] Metadata pull failed", error);
            }
            break;
          }
          const rawRows = (data ?? []) as Array<Record<string, unknown>>;
          if (!rawRows.length) break;
          const rows = rawRows as AppRemoteWorkspaceFileRow[];
          const result = await window.bukowskiApp!.applyRemoteWorkspaceFiles({
            workspaceId: activeWorkspaceId,
            rows,
          });
          const canAdvance = canAdvanceCompositePullCursor(result);
          if (canAdvance) {
            const nextCursor = cursorFromRow(rawRows[rawRows.length - 1], "updated_at", "id");
            if (nextCursor) {
              cursor = nextCursor;
              writeCompositePullCursor(key, cursor);
            }
          }
          if (result.appliedCount > 0) appliedAny = true;
          if (rows.length < PULL_BATCH_SIZE || !canAdvance) break;
        }
        if (appliedAny) notifyWorkspaceDataChanged({ source: "sync", entities: ["assets", "incidents", "finance", "crew"] });
      } catch (error) {
        console.warn("[workspace-file-pull] Pull pass failed", error);
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
