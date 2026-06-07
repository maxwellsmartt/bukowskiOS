import { useEffect, useRef } from "react";

import type {
  AppRemoteCatalogRow,
  AppRemoteExchangeRateRow,
  CatalogPullEntityType,
} from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";

import { immediatePullEvent } from "./useWorkspaceDataRefresh";
/* eslint-disable no-console */

const POLL_INTERVAL_MS = 60_000;
const PULL_BATCH_SIZE = 200;

type PullCursor = {
  workspaceId: string;
  entityType: CatalogPullEntityType;
  cursor: string | null;
};

const buildCursorKey = ({ workspaceId, entityType }: PullCursor) =>
  `bukowski:catalog-pull-cursor:${workspaceId}:${entityType}`;

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
    // ignore storage errors
  }
};

// Catalog tables pulled from Supabase. clients/manufacturers/production_companies
// gained their Supabase mirror + local-first sync in
// 20260531120000_catalog_business_entities_sync. PGRST205 ("table not in schema
// cache") is still handled gracefully below so a not-yet-migrated remote degrades
// quietly instead of spamming 404s.
const entityTables: CatalogPullEntityType[] = [
  "asset_categories",
  "locations",
  "clients",
  "manufacturers",
  "production_companies",
];
const RATES_CURSOR_KEY = (workspaceId: string) =>
  `bukowski:catalog-pull-cursor:${workspaceId}:exchange_rates`;

const errorLogger = {
  warn: (label: string, error: unknown) => {
    console.warn(`[catalog-pull] ${label}`, error);
  },
};

/**
 * Pulls catalog tables (asset_categories, locations) from Supabase remote into the
 * local SQLite via IPC. Conflict resolution (LWW + outbox guard) lives in
 * `catalogPullService` on the main process. The cursor is stored in localStorage
 * per workspace+entity so we only fetch deltas.
 *
 * Activates only when supabase is configured and the workspace is ready.
 */
export const useCatalogPull = () => {
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
      !window.bukowskiApp?.applyRemoteCatalogRows
    ) {
      return undefined;
    }

    const runOnce = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        for (const entityType of entityTables) {
          const cursorKey = buildCursorKey({ workspaceId: activeWorkspaceId, entityType, cursor: null });
          const cursor = readCursor(cursorKey);

          let query = supabase
            .from(entityType)
            .select("*")
            .eq("workspace_id", activeWorkspaceId)
            .order("updated_at", { ascending: true })
            .limit(PULL_BATCH_SIZE);

          if (cursor) {
            query = query.gt("updated_at", cursor);
          }

          const { data, error } = await query;
          if (error) {
            // PGRST205 = table is not in the PostgREST schema cache (i.e. the
            // remote table doesn't exist yet). That's expected for catalog
            // entities still pending a Supabase mirror; skip quietly so we
            // don't spam the console on every poll.
            if ((error as { code?: string }).code !== "PGRST205") {
              errorLogger.warn(`Catalog pull ${entityType} failed`, error);
            }
            continue;
          }

          const rows: AppRemoteCatalogRow[] = (data ?? []).map((row) => row as AppRemoteCatalogRow);
          if (!rows.length) {
            continue;
          }

          const result = await window.bukowskiApp!.applyRemoteCatalogRows({
            workspaceId: activeWorkspaceId,
            entityType,
            rows,
          });

          if (result.cursorAfter) {
            writeCursor(cursorKey, result.cursorAfter);
          }
        }

        // Exchange rates pull (Plan L FQ7). Different shape, separate cursor.
        if (window.bukowskiApp?.applyRemoteExchangeRates) {
          const ratesCursorKey = RATES_CURSOR_KEY(activeWorkspaceId);
          const ratesCursor = readCursor(ratesCursorKey);
          let ratesQuery = supabase
            .from("exchange_rates")
            .select("*")
            .eq("workspace_id", activeWorkspaceId)
            .order("created_at", { ascending: true })
            .limit(PULL_BATCH_SIZE);
          if (ratesCursor) ratesQuery = ratesQuery.gt("created_at", ratesCursor);

          const { data: rateRows, error: ratesError } = await ratesQuery;
          if (ratesError) {
            errorLogger.warn("Exchange rate pull failed", ratesError);
          } else if (rateRows && rateRows.length > 0) {
            const rows = rateRows.map((row) => row as unknown as AppRemoteExchangeRateRow);
            const result = await window.bukowskiApp.applyRemoteExchangeRates({
              workspaceId: activeWorkspaceId,
              rows,
            });
            if (result.cursorAfter) writeCursor(ratesCursorKey, result.cursorAfter);
          }
        }
      } catch (error) {
        errorLogger.warn("Catalog pull pass failed", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    void runOnce();
    const onImmediatePull = () => void runOnce();
    window.addEventListener(immediatePullEvent, onImmediatePull);
    const intervalId = window.setInterval(() => {
      void runOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(immediatePullEvent, onImmediatePull);
    };
  }, [activeWorkspaceId, isLocalFallback, isWorkspaceReady, status, supabase]);
};
