import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import type { AppRemoteOperationalSnapshotRow, OperationalSnapshotEntityType } from "@contracts";

const POLL_INTERVAL_MS = 60_000;
const PULL_BATCH_SIZE = 100;
const MAX_BATCHES_PER_ENTITY = 3;

const entityTypes: OperationalSnapshotEntityType[] = ["project", "packing_slip", "incident", "rma_case"];

const cursorKey = (workspaceId: string, entityType: OperationalSnapshotEntityType) =>
  `bukowski:operational-snapshot-pull-cursor:${workspaceId}:${entityType}`;

const readCursor = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeCursor = (key: string, value: string | null) => {
  try {
    if (value == null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage errors; pull remains idempotent and can retry from an older cursor.
  }
};

const mapSnapshot = (row: Record<string, unknown>): AppRemoteOperationalSnapshotRow => ({
  workspace_id: String(row.workspace_id),
  entity_type: String(row.entity_type) as OperationalSnapshotEntityType,
  entity_id: String(row.entity_id),
  snapshot_json:
    row.snapshot_json && typeof row.snapshot_json === "object" && !Array.isArray(row.snapshot_json)
      ? (row.snapshot_json as Record<string, unknown>)
      : {},
  updated_at: String(row.updated_at),
  deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : null,
});

export const useOperationalSnapshotPull = () => {
  const { supabase, isLocalFallback, status } = useSession();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (
      !supabase ||
      isLocalFallback ||
      status !== "authenticated" ||
      !isWorkspaceReady ||
      !activeWorkspaceId ||
      !window.bukowskiApp?.applyRemoteOperationalSnapshots
    ) {
      return undefined;
    }
    const appApi = window.bukowskiApp;

    const runOnce = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        for (const entityType of entityTypes) {
          const key = cursorKey(activeWorkspaceId, entityType);
          let cursor = readCursor(key);

          for (let batch = 0; batch < MAX_BATCHES_PER_ENTITY; batch += 1) {
            let query = supabase
              .from("operational_snapshots")
              .select("*")
              .eq("workspace_id", activeWorkspaceId)
              .eq("entity_type", entityType)
              .order("updated_at", { ascending: true })
              .limit(PULL_BATCH_SIZE);

            if (cursor) {
              query = query.gt("updated_at", cursor);
            }

            const { data, error } = await query;
            if (error) {
              console.warn(`[operational-snapshot-pull] ${entityType} pull failed`, error);
              break;
            }

            const rows = (data ?? []).map((row) => mapSnapshot(row as Record<string, unknown>));
            if (!rows.length) {
              break;
            }

            const result = await appApi.applyRemoteOperationalSnapshots({
              workspaceId: activeWorkspaceId,
              entityType,
              rows,
            });

            if (result.cursorAfter) {
              cursor = result.cursorAfter;
              writeCursor(key, cursor);
            }

            if (rows.length < PULL_BATCH_SIZE || result.errors.length > 0) {
              break;
            }
          }
        }
      } catch (error) {
        console.warn("[operational-snapshot-pull] Pull pass failed", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    void runOnce();
    const interval = window.setInterval(() => void runOnce(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activeWorkspaceId, isLocalFallback, isWorkspaceReady, status, supabase]);
};
