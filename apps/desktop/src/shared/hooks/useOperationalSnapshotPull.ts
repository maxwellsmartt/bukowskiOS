import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import type { AppRemoteOperationalSnapshotRow, OperationalSnapshotEntityType } from "@contracts";
import {
  applyCompositePullCursor,
  cursorFromRow,
  readCompositePullCursor,
  writeCompositePullCursor,
} from "@shared/lib/compositePullCursor";

import { immediatePullEvent, notifyWorkspaceDataChanged } from "./useWorkspaceDataRefresh";

const POLL_INTERVAL_MS = 60_000;
const PULL_BATCH_SIZE = 100;
const MAX_BATCHES_PER_ENTITY = 3;

const entityTypes: OperationalSnapshotEntityType[] = ["project", "packing_slip", "incident", "rma_case"];

const cursorKey = (workspaceId: string, entityType: OperationalSnapshotEntityType) =>
  `bukowski:operational-snapshot-pull-cursor:${workspaceId}:${entityType}:v2`;

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
  const rerunRequestedRef = useRef(false);

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
      if (inFlightRef.current) {
        rerunRequestedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      let appliedAny = false;

      try {
        for (const entityType of entityTypes) {
          const key = cursorKey(activeWorkspaceId, entityType);
          let cursor = readCompositePullCursor(key);

          for (let batch = 0; batch < MAX_BATCHES_PER_ENTITY; batch += 1) {
            let query = (supabase as any)
              .from("operational_snapshots")
              .select("*")
              .eq("workspace_id", activeWorkspaceId)
              .eq("entity_type", entityType)
              .order("updated_at", { ascending: true })
              .order("entity_id", { ascending: true })
              .limit(PULL_BATCH_SIZE);
            query = applyCompositePullCursor(query, cursor, "updated_at", "entity_id");

            const { data, error } = await query;
            if (error) {
              console.warn(`[operational-snapshot-pull] ${entityType} pull failed`, error);
              break;
            }

            const rawRows = (data ?? []) as Array<Record<string, unknown>>;
            const rows = rawRows.map((row) => mapSnapshot(row));
            if (!rows.length) {
              break;
            }

            const result = await appApi.applyRemoteOperationalSnapshots({
              workspaceId: activeWorkspaceId,
              entityType,
              rows,
            });

            if (result.errors.length === 0) {
              const nextCursor = cursorFromRow(rawRows[rawRows.length - 1], "updated_at", "entity_id");
              if (nextCursor) {
                cursor = nextCursor;
                writeCompositePullCursor(key, cursor);
              }
            }
            if (result.appliedCount > 0) appliedAny = true;

            if (rows.length < PULL_BATCH_SIZE || result.errors.length > 0) {
              break;
            }
          }
        }
        if (appliedAny) {
          notifyWorkspaceDataChanged({ source: "sync", entities: ["projects", "operations"] });
        }
      } catch (error) {
        console.warn("[operational-snapshot-pull] Pull pass failed", error);
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
