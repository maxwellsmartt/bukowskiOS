import { useEffect, useRef } from "react";

import type { AppRemoteAutomationControlPlaneRow, AutomationControlPlanePullEntityType } from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { applyCompositePullCursor, cursorFromRow, readCompositePullCursor, writeCompositePullCursor } from "@shared/lib/compositePullCursor";

import { immediatePullEvent, notifyWorkspaceDataChanged } from "./useWorkspaceDataRefresh";

const POLL_INTERVAL_MS = 45_000;
const PULL_BATCH_SIZE = 150;

const entityTables: AutomationControlPlanePullEntityType[] = ["agents", "ai_provider_configs", "agent_connector_configs"];

const cursorKey = (workspaceId: string, entityType: AutomationControlPlanePullEntityType) =>
  `bukowski:automation-control-plane-pull-cursor:${workspaceId}:${entityType}`;

export const useAutomationControlPlanePull = () => {
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
      !window.bukowskiApp?.applyRemoteAutomationControlPlaneRows
    ) {
      return undefined;
    }

    const runOnce = async () => {
      if (inFlightRef.current) {
        rerunRequestedRef.current = true;
        return;
      }
      const appApi = window.bukowskiApp;
      if (!appApi?.applyRemoteAutomationControlPlaneRows) return;
      inFlightRef.current = true;
      let appliedAny = false;

      try {
        for (const entityType of entityTables) {
          const key = cursorKey(activeWorkspaceId, entityType);
          const cursor = readCompositePullCursor(key);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let query = (supabase as any)
            .from(entityType)
            .select("*")
            .eq("workspace_id", activeWorkspaceId)
            .order("updated_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(PULL_BATCH_SIZE);

          query = applyCompositePullCursor(query, cursor, "updated_at", "id");

          const { data, error } = await query;
          if (error) {
            if ((error as { code?: string }).code !== "PGRST205") {
              console.warn(
                `[automation-control-plane-pull] ${entityType} pull failed: ${getUserFacingErrorMessage(
                  error,
                  "Unknown automation pull error.",
                )}`,
                error,
              );
            }
            continue;
          }

          const rows = (data ?? []) as AppRemoteAutomationControlPlaneRow[];
          if (!rows.length) continue;

          const result = await appApi.applyRemoteAutomationControlPlaneRows({
            workspaceId: activeWorkspaceId,
            entityType,
            rows,
          });
          if (result.errors.length === 0) {
            const nextCursor = cursorFromRow(rows[rows.length - 1] as unknown as Record<string, unknown>, "updated_at", "id");
            if (nextCursor) writeCompositePullCursor(key, nextCursor);
          }
          if (result.appliedCount > 0) appliedAny = true;
          if (result.errors.length > 0) {
            console.warn(`[automation-control-plane-pull] ${entityType} apply had errors: ${result.errors.join("; ")}`, result.errors);
          }
        }

        if (appliedAny) {
          notifyWorkspaceDataChanged({ source: "sync", entities: ["agents"] });
        }
      } catch (error) {
        console.warn(
          `[automation-control-plane-pull] Pull pass failed: ${getUserFacingErrorMessage(
            error,
            "Unknown automation pull pass error.",
          )}`,
          error,
        );
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
