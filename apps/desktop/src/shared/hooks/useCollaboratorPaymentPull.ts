import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import type { CollaboratorPaymentPullTable } from "@contracts";
import { notifyWorkspaceDataChanged } from "./useWorkspaceDataRefresh";

const POLL_INTERVAL_MS = 60_000;
const PULL_BATCH_SIZE = 250;

const tableConfigs: Array<{ table: CollaboratorPaymentPullTable; cursorColumn: string }> = [
  { table: "collaborator_fees", cursorColumn: "updated_at" },
  { table: "collaborator_payment_batches", cursorColumn: "created_at" },
  { table: "collaborator_fee_payments", cursorColumn: "created_at" },
];

const cursorKey = (workspaceId: string, table: CollaboratorPaymentPullTable) =>
  `bukowski:collaborator-payment-pull-cursor:${workspaceId}:${table}`;

const readCursor = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeCursor = (key: string, value: string | null) => {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Best effort only; an older cursor is safe because apply is idempotent.
  }
};

export const useCollaboratorPaymentPull = () => {
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
      !window.bukowskiApp?.applyRemoteCollaboratorPaymentRows
    ) {
      return undefined;
    }

    const runOnce = async () => {
      if (inFlightRef.current) return;
      const appApi = window.bukowskiApp;
      if (!appApi?.applyRemoteCollaboratorPaymentRows) return;
      inFlightRef.current = true;
      let appliedAny = false;

      try {
        for (const { table, cursorColumn } of tableConfigs) {
          const key = cursorKey(activeWorkspaceId, table);
          const cursor = readCursor(key);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let query = (supabase as any)
            .from(table)
            .select("*")
            .eq("workspace_id", activeWorkspaceId)
            .order(cursorColumn, { ascending: true })
            .limit(PULL_BATCH_SIZE);

          if (cursor) query = query.gt(cursorColumn, cursor);
          const { data, error } = await query;
          if (error) {
            console.warn(`[collaborator-payment-pull] ${table} pull failed`, error);
            continue;
          }

          const rows = (data ?? []) as Array<Record<string, unknown>>;
          if (!rows.length) continue;

          const result = await appApi.applyRemoteCollaboratorPaymentRows({
            workspaceId: activeWorkspaceId,
            table,
            rows,
          });
          if (result.cursorAfter) writeCursor(key, result.cursorAfter);
          if (result.appliedCount > 0) appliedAny = true;
          if (result.errors.length > 0) {
            console.warn(`[collaborator-payment-pull] ${table} apply had errors`, result.errors);
          }
        }

        if (appliedAny) notifyWorkspaceDataChanged({ source: "sync", entities: ["collaborator_payments"] });
      } catch (error) {
        console.warn("[collaborator-payment-pull] Pull pass failed", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    void runOnce();
    const interval = window.setInterval(() => void runOnce(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activeWorkspaceId, isLocalFallback, isWorkspaceReady, status, supabase]);
};
