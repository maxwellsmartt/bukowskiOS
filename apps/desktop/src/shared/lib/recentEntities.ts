import type { GlobalSearchEntityType } from "@contracts";

import { readJsonPreference, uiPreferenceKeys, writeJsonPreference } from "./preferences";

const maxRecentEntityKeys = 24;

export const buildRecentEntityKey = (entityType: GlobalSearchEntityType, entityId: string) => `${entityType}:${entityId}`;

export const readRecentEntityKeys = () => readJsonPreference<string[]>(uiPreferenceKeys.recentEntityKeys, []);

export const pushRecentEntityKey = (entityType: GlobalSearchEntityType, entityId: string) => {
  const nextKey = buildRecentEntityKey(entityType, entityId);
  const currentKeys = readRecentEntityKeys();
  const nextKeys = [nextKey, ...currentKeys.filter((key) => key !== nextKey)].slice(0, maxRecentEntityKeys);
  writeJsonPreference(uiPreferenceKeys.recentEntityKeys, nextKeys);
  return nextKeys;
};
