import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import type { AppRemoteAssetCurrentStateRow, AppRemoteAssetSnapshotRow } from "@contracts";

const POLL_INTERVAL_MS = 60_000;
const PULL_BATCH_SIZE = 200;
const MAX_BATCHES_PER_PASS = 5;

const cursorKey = (workspaceId: string) => `bukowski:asset-snapshot-pull-cursor:${workspaceId}`;

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
    // Ignore storage errors; the next pull can safely retry from an older cursor.
  }
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const mapAsset = (row: Record<string, unknown>): AppRemoteAssetSnapshotRow => ({
  id: String(row.id),
  workspace_id: String(row.workspace_id),
  category_id: String(row.category_id),
  name: String(row.name),
  brand: toNullableString(row.brand),
  model: toNullableString(row.model),
  serial_number: toNullableString(row.serial_number),
  internal_code: String(row.internal_code),
  description: toNullableString(row.description),
  purchase_date: toNullableString(row.purchase_date),
  purchase_price: toNumberOrNull(row.purchase_price),
  additional_costs: toNumberOrNull(row.additional_costs),
  currency: toNullableString(row.currency),
  replacement_value: toNumberOrNull(row.replacement_value),
  current_book_value: toNumberOrNull(row.current_book_value),
  ownership_type: toNullableString(row.ownership_type),
  default_location_id: toNullableString(row.default_location_id),
  qr_code_value: toNullableString(row.qr_code_value),
  notes: toNullableString(row.notes),
  is_active: row.is_active === false ? false : true,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at),
});

const mapState = (row: Record<string, unknown>): AppRemoteAssetCurrentStateRow => ({
  asset_id: String(row.asset_id),
  workspace_id: String(row.workspace_id),
  current_location_id: toNullableString(row.current_location_id),
  current_project_id: toNullableString(row.current_project_id),
  current_department_id: toNullableString(row.current_department_id),
  current_responsible_user_id: toNullableString(row.current_responsible_user_id),
  active_assignment_id: toNullableString(row.active_assignment_id),
  condition_status: String(row.condition_status),
  operational_status: String(row.operational_status),
  custody_status: String(row.custody_status),
  last_event_id: String(row.last_event_id),
  version: toNumberOrNull(row.version),
  updated_at: String(row.updated_at),
  project_unit_id: toNullableString(row.project_unit_id),
  total_quantity: toNumberOrNull(row.total_quantity),
  available_quantity: toNumberOrNull(row.available_quantity),
  assigned_quantity: toNumberOrNull(row.assigned_quantity),
  checked_out_quantity: toNumberOrNull(row.checked_out_quantity),
});

/**
 * Pulls remote asset snapshots into local SQLite so a new device can see the
 * workspace inventory without waiting for local seed data. Local pending outbox
 * rows still win inside the main-process apply service.
 */
export const useAssetSnapshotPull = () => {
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
      !window.bukowskiApp?.applyRemoteAssetSnapshots
    ) {
      return undefined;
    }

    const remote = supabase as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            order: (column: string, options: { ascending: boolean }) => {
              limit: (count: number) => {
                gt: (column: string, value: string) => Promise<{ data: unknown[] | null; error: unknown }>;
              } & Promise<{ data: unknown[] | null; error: unknown }>;
            };
          };
          in: (column: string, values: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
    const appApi = window.bukowskiApp;

    const runOnce = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const key = cursorKey(activeWorkspaceId);
        let cursor = readCursor(key);

        for (let batch = 0; batch < MAX_BATCHES_PER_PASS; batch += 1) {
          const stateQuery = remote
            .from("asset_current_state")
            .select("*")
            .eq("workspace_id", activeWorkspaceId)
            .order("updated_at", { ascending: true })
            .limit(PULL_BATCH_SIZE);

          const { data: stateRows, error: stateError } = await (cursor
            ? stateQuery.gt("updated_at", cursor)
            : stateQuery);
          if (stateError) {
            console.warn("[asset-snapshot-pull] State pull failed", stateError);
            break;
          }

          const states = (stateRows ?? []).map((row) => mapState(row as Record<string, unknown>));
          if (!states.length) {
            break;
          }

          const assetIds = Array.from(new Set(states.map((state) => state.asset_id)));
          const { data: assetRows, error: assetError } = await remote
            .from("assets")
            .select("*")
            .in("id", assetIds);

          if (assetError) {
            console.warn("[asset-snapshot-pull] Asset pull failed", assetError);
            break;
          }

          const assets = (assetRows ?? [])
            .map((row) => mapAsset(row as Record<string, unknown>))
            .filter((asset) => asset.workspace_id === activeWorkspaceId);

          const result = await appApi!.applyRemoteAssetSnapshots({
            workspaceId: activeWorkspaceId,
            assets,
            states,
          });

          if (result.cursorAfter) {
            cursor = result.cursorAfter;
            writeCursor(key, cursor);
          }

          if (states.length < PULL_BATCH_SIZE || result.errors.length > 0) {
            break;
          }
        }
      } catch (error) {
        console.warn("[asset-snapshot-pull] Pull pass failed", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    void runOnce();
    const interval = window.setInterval(() => void runOnce(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activeWorkspaceId, isLocalFallback, isWorkspaceReady, status, supabase]);
};
