import { useEffect, useRef } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import type { TreasuryPullTable } from "@contracts";
import { canReadTreasury } from "@shared/lib/financeAccess";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { immediatePullEvent, notifyWorkspaceDataChanged } from "./useWorkspaceDataRefresh";

const POLL_INTERVAL_MS = 20_000;
const PULL_BATCH_SIZE = 250;
const MAX_PAGES_PER_TABLE = 6;

const tableConfigs: Array<{ table: TreasuryPullTable; cursorColumn: string }> = [
  { table: "bank_accounts", cursorColumn: "updated_at" },
  { table: "bank_statement_imports", cursorColumn: "created_at" },
  { table: "bank_transactions", cursorColumn: "created_at" },
  { table: "transaction_annotations", cursorColumn: "updated_at" },
  { table: "transaction_project_allocations", cursorColumn: "updated_at" },
  { table: "transaction_links", cursorColumn: "created_at" },
  { table: "counterparty_rules", cursorColumn: "updated_at" },
];

const cursorVersions: Partial<Record<TreasuryPullTable, string>> = {
  transaction_annotations: "v2",
};

const cursorKey = (workspaceId: string, table: TreasuryPullTable) =>
  `bukowski:treasury-pull-cursor:${workspaceId}:${table}:${cursorVersions[table] ?? "v1"}`;

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

export const useTreasuryPull = () => {
  const { supabase, isLocalFallback, status } = useSession();
  const { activeMembership, activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const inFlightRef = useRef(false);
  const canPullTreasury = canReadTreasury(activeMembership);

  useEffect(() => {
    if (
      !supabase ||
      isLocalFallback ||
      status !== "authenticated" ||
      !isWorkspaceReady ||
      !canPullTreasury ||
      !activeWorkspaceId ||
      !window.bukowskiApp?.applyRemoteTreasuryRows
    ) {
      return undefined;
    }

    const runOnce = async () => {
      if (inFlightRef.current) return;
      const appApi = window.bukowskiApp;
      if (!appApi?.applyRemoteTreasuryRows) return;
      inFlightRef.current = true;
      let appliedAny = false;

      try {
        for (const { table, cursorColumn } of tableConfigs) {
          const key = cursorKey(activeWorkspaceId, table);
          let cursor = readCursor(key);
          for (let page = 0; page < MAX_PAGES_PER_TABLE; page += 1) {
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
              console.warn(
                `[treasury-pull] ${table} pull failed: ${getUserFacingErrorMessage(error, "Unknown treasury pull error.")}`,
                error,
              );
              break;
            }

            const rows = (data ?? []) as Array<Record<string, unknown>>;
            if (!rows.length) break;

            const result = await appApi.applyRemoteTreasuryRows({
              workspaceId: activeWorkspaceId,
              table,
              rows,
            });
            if (result.cursorAfter) {
              cursor = result.cursorAfter;
              writeCursor(key, result.cursorAfter);
            }
            if (result.appliedCount > 0) appliedAny = true;
            if (result.errors.length > 0) {
              console.warn(`[treasury-pull] ${table} apply had errors: ${result.errors.join("; ")}`, result.errors);
              break;
            }
            if (!result.cursorAfter || rows.length < PULL_BATCH_SIZE) break;
          }
        }

        if (appliedAny) notifyWorkspaceDataChanged();
      } catch (error) {
        console.warn(
          `[treasury-pull] Pull pass failed: ${getUserFacingErrorMessage(error, "Unknown treasury pull pass error.")}`,
          error,
        );
      } finally {
        inFlightRef.current = false;
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
  }, [activeWorkspaceId, canPullTreasury, isLocalFallback, isWorkspaceReady, status, supabase]);
};
