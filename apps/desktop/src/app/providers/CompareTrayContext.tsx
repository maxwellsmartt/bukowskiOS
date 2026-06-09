import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { CompareEntityType, CompareItem, CompareTrayGroup, CompareTrayState } from "@contracts";
import { readJsonPreference, uiPreferenceKeys, writeJsonPreference } from "@shared/lib/preferences";

type CompareTrayContextValue = {
  items: CompareItem[];
  groups: CompareTrayGroup[];
  compatibleType: CompareEntityType | null;
  compatibleItems: CompareItem[];
  reasonDisabled: string | null;
  addItems: (items: CompareItem[]) => void;
  replaceItems: (items: CompareItem[]) => void;
  removeItem: (entityType: CompareEntityType, entityId: string) => void;
  clear: () => void;
  hasItem: (entityType: CompareEntityType, entityId: string) => boolean;
};

const CompareTrayContext = createContext<CompareTrayContextValue | null>(null);

const emptyState: CompareTrayState = {
  items: [],
  groups: [],
  activeComparableType: null,
  disabledReason: "Add items from Assets, Projects or Finance to compare them later.",
};

const buildGroups = (items: CompareItem[]): CompareTrayGroup[] => {
  const groupMap = new Map<CompareEntityType, CompareItem[]>();

  items.forEach((item) => {
    const current = groupMap.get(item.entityType) ?? [];
    current.push(item);
    groupMap.set(item.entityType, current);
  });

  return Array.from(groupMap.entries()).map(([entityType, groupItems]) => ({
    entityType,
    itemIds: groupItems.map((item) => item.id),
    count: groupItems.length,
    comparable: groupItems.length >= 2,
  }));
};

const resolveCompatibility = (groups: CompareTrayGroup[]) => {
  const groupsWithEnoughItems = groups.filter((group) => group.comparable);

  if (!groups.length) {
    return {
      compatibleType: null,
      compatibleItems: [],
      reasonDisabled: "Add items from Assets, Projects or Finance to compare them later.",
    };
  }

  if (!groupsWithEnoughItems.length) {
    return {
      compatibleType: null,
      compatibleItems: [],
      reasonDisabled: "Add at least two items of the same type to enable compare.",
    };
  }

  const preferredGroup =
    groupsWithEnoughItems.find((group) => group.entityType === "asset") ??
    groupsWithEnoughItems.find((group) => group.entityType === "project") ??
    groupsWithEnoughItems[0];
  const compatibleItems = preferredGroup.itemIds;

  const mixedTypes = groups.length > 1;

  return {
    compatibleType: preferredGroup.entityType,
    compatibleItems,
    reasonDisabled: mixedTypes
      ? `Tray is mixed. ${compatibleItems.length} ${preferredGroup.entityType.replace("_", " ")} items are ready to compare.`
      : null,
  };
};

export const CompareTrayProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<CompareItem[]>(() => {
    const savedState = readJsonPreference<CompareTrayState>(uiPreferenceKeys.compareTrayState, emptyState);
    return savedState.items ?? [];
  });

  const groups = useMemo(() => buildGroups(items), [items]);
  const compatibility = useMemo(() => resolveCompatibility(groups), [groups]);
  const compatibleItems = useMemo(
    () =>
      items.filter(
        (item) => compatibility.compatibleType !== null && item.entityType === compatibility.compatibleType,
      ),
    [compatibility.compatibleType, items],
  );

  useEffect(() => {
    writeJsonPreference(uiPreferenceKeys.compareTrayState, {
      items,
      groups,
      activeComparableType: compatibility.compatibleType,
      disabledReason: compatibility.reasonDisabled,
    });
  }, [compatibility.compatibleType, compatibility.reasonDisabled, groups, items]);

  const addItems = useCallback((nextItems: CompareItem[]) => {
    setItems((current) => {
      const merged = [...current];

      nextItems.forEach((nextItem) => {
        if (merged.some((currentItem) => currentItem.entityType === nextItem.entityType && currentItem.id === nextItem.id)) {
          return;
        }

        merged.push(nextItem);
      });

      return merged;
    });
  }, []);

  const replaceItems = useCallback((nextItems: CompareItem[]) => setItems(nextItems), []);

  const removeItem = useCallback((entityType: CompareEntityType, entityId: string) => {
    setItems((current) => current.filter((item) => !(item.entityType === entityType && item.id === entityId)));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CompareTrayContextValue>(
    () => ({
      items,
      groups,
      compatibleType: compatibility.compatibleType,
      compatibleItems,
      reasonDisabled: compatibility.reasonDisabled,
      addItems,
      replaceItems,
      removeItem,
      clear,
      hasItem: (entityType, entityId) => items.some((item) => item.entityType === entityType && item.id === entityId),
    }),
    [addItems, clear, compatibility.compatibleType, compatibility.reasonDisabled, compatibleItems, groups, items, removeItem, replaceItems],
  );

  return <CompareTrayContext.Provider value={value}>{children}</CompareTrayContext.Provider>;
};

export const useCompareTray = () => {
  const value = useContext(CompareTrayContext);

  if (!value) {
    throw new Error("useCompareTray must be used within CompareTrayProvider");
  }

  return value;
};
