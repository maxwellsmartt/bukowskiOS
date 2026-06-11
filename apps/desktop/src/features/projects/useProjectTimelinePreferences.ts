import { useCallback, useMemo } from "react";

import { useUserSetting } from "@shared/hooks/useUserSetting";
import {
  userSettingKeys,
  type ProjectTimelinePreferencesMap,
  type ProjectTimelineWorkspacePreference,
} from "@shared/lib/userSettings";

const uniqueIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

const normalizeWorkspacePreference = (
  value: ProjectTimelineWorkspacePreference | undefined,
): ProjectTimelineWorkspacePreference => ({
  hiddenProjectIds: uniqueIds(value?.hiddenProjectIds ?? []),
  order: uniqueIds(value?.order ?? []),
});

export const useProjectTimelinePreferences = (workspaceId: string | null | undefined) => {
  const [preferences, setPreferences] = useUserSetting(userSettingKeys.projectTimelinePreferences);

  const workspacePreference = useMemo(
    () => normalizeWorkspacePreference(workspaceId ? preferences?.[workspaceId] : undefined),
    [preferences, workspaceId],
  );

  const updateWorkspacePreference = useCallback(
    async (
      updater:
        | ProjectTimelineWorkspacePreference
        | ((current: ProjectTimelineWorkspacePreference) => ProjectTimelineWorkspacePreference),
    ) => {
      if (!workspaceId) {
        return;
      }

      const currentPreference = normalizeWorkspacePreference(preferences?.[workspaceId]);
      const nextPreference = normalizeWorkspacePreference(
        typeof updater === "function" ? updater(currentPreference) : updater,
      );
      const nextPreferences: ProjectTimelinePreferencesMap = {
        ...(preferences ?? {}),
        [workspaceId]: nextPreference,
      };

      if (!nextPreference.hiddenProjectIds?.length && !nextPreference.order?.length) {
        delete nextPreferences[workspaceId];
      }

      await setPreferences(Object.keys(nextPreferences).length ? nextPreferences : undefined);
    },
    [preferences, setPreferences, workspaceId],
  );

  const setProjectOrder = useCallback(
    (order: string[]) =>
      updateWorkspacePreference((current) => ({
        ...current,
        order: uniqueIds(order),
      })),
    [updateWorkspacePreference],
  );

  const toggleProjectHidden = useCallback(
    (projectId: string) =>
      updateWorkspacePreference((current) => {
        const hiddenProjectIds = new Set(current.hiddenProjectIds ?? []);
        if (hiddenProjectIds.has(projectId)) {
          hiddenProjectIds.delete(projectId);
        } else {
          hiddenProjectIds.add(projectId);
        }

        return {
          ...current,
          hiddenProjectIds: Array.from(hiddenProjectIds),
        };
      }),
    [updateWorkspacePreference],
  );

  return {
    hiddenProjectIds: workspacePreference.hiddenProjectIds ?? [],
    order: workspacePreference.order ?? [],
    setProjectOrder,
    toggleProjectHidden,
  };
};
