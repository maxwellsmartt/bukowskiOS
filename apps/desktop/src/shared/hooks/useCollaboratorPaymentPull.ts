import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import type { CollaboratorPaymentPullTable } from "@contracts";
import { canReadCollaboratorPayments } from "@shared/lib/financeAccess";
import { applyCompositePullCursor, canAdvanceCompositePullCursor, cursorFromRow, readCompositePullCursor, writeCompositePullCursor } from "@shared/lib/compositePullCursor";
import { immediatePullEvent, notifyWorkspaceDataChanged } from "./useWorkspaceDataRefresh";

const POLL_INTERVAL_MS = 20_000;
const PULL_BATCH_SIZE = 250;

const tableConfigs: Array<{ table: CollaboratorPaymentPullTable; cursorColumn: string }> = [
  { table: "collaborator_fees", cursorColumn: "updated_at" },
  { table: "collaborator_payment_batches", cursorColumn: "created_at" },
  { table: "collaborator_fee_payments", cursorColumn: "created_at" },
];

const cursorKey = (workspaceId: string, table: CollaboratorPaymentPullTable) =>
  `bukowski:collaborator-payment-pull-cursor:${workspaceId}:${table}`;

export const useCollaboratorPaymentPull = () => {
  const { supabase, isLocalFallback, status } = useSession();
  const { activeMembership, activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const inFlightRef = useRef(false);
  const rerunRequestedRef = useRef(false);
  const canPullCollaboratorPayments = canReadCollaboratorPayments(activeMembership);

  useEffect(() => {
    if (
      !supabase ||
      isLocalFallback ||
      status !== "authenticated" ||
      !isWorkspaceReady ||
      !canPullCollaboratorPayments ||
      !activeWorkspaceId ||
      !window.bukowskiApp?.applyRemoteCollaboratorPaymentRows
    ) {
      return undefined;
    }

    const runOnce = async () => {
      if (inFlightRef.current) {
        rerunRequestedRef.current = true;
        return;
      }
      const appApi = window.bukowskiApp;
      if (!appApi?.applyRemoteCollaboratorPaymentRows) return;
      inFlightRef.current = true;
      let appliedAny = false;

      try {
        for (const { table, cursorColumn } of tableConfigs) {
          const key = cursorKey(activeWorkspaceId, table);
          const cursor = readCompositePullCursor(key);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let query = (supabase as any)
            .from(table)
            .select("*")
            .eq("workspace_id", activeWorkspaceId)
            .order(cursorColumn, { ascending: true })
            .order("id", { ascending: true })
            .limit(PULL_BATCH_SIZE);

          query = applyCompositePullCursor(query, cursor, cursorColumn, "id");
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
          if (canAdvanceCompositePullCursor(result)) {
            const nextCursor = cursorFromRow(rows[rows.length - 1], cursorColumn, "id");
            if (nextCursor) writeCompositePullCursor(key, nextCursor);
          }
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
  }, [activeWorkspaceId, canPullCollaboratorPayments, isLocalFallback, isWorkspaceReady, status, supabase]);
};
