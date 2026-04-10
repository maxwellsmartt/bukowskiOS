import type { ListSortDirection } from "@contracts";
import { useEffect, useMemo, useState } from "react";

import { readJsonPreference, writeJsonPreference } from "@shared/lib/preferences";

import { useDebouncedValue } from "./useDebouncedValue";

export type ListSortOption<TSort extends string> = {
  value: TSort;
  label: string;
  columnKey?: string;
};

type ListControlState<TSort extends string> = {
  search: string;
  sortBy: TSort;
  sortDirection: ListSortDirection;
};

type UseListControlsOptions<TSort extends string, TQuery> = {
  viewKey: string;
  defaults: ListControlState<TSort>;
  sortOptions: Array<ListSortOption<TSort>>;
  buildQuery: (state: ListControlState<TSort>) => TQuery;
  debounceMs?: number;
  defaultDirectionBySort?: Partial<Record<TSort, ListSortDirection>>;
};

const resolveStoredState = <TSort extends string>(
  viewKey: string,
  defaults: ListControlState<TSort>,
): Pick<ListControlState<TSort>, "sortBy" | "sortDirection"> => {
  const storedState = readJsonPreference<Partial<ListControlState<TSort>>>(`list-controls:${viewKey}`, {});

  return {
    sortBy: storedState.sortBy ?? defaults.sortBy,
    sortDirection: storedState.sortDirection ?? defaults.sortDirection,
  };
};

export const useListControls = <TSort extends string, TQuery>({
  viewKey,
  defaults,
  sortOptions,
  buildQuery,
  debounceMs = 120,
  defaultDirectionBySort,
}: UseListControlsOptions<TSort, TQuery>) => {
  const { search: defaultSearch, sortBy: defaultSortBy, sortDirection: defaultSortDirection } = defaults;
  const persistedState = useMemo(
    () =>
      resolveStoredState(viewKey, {
        search: defaultSearch,
        sortBy: defaultSortBy,
        sortDirection: defaultSortDirection,
      }),
    [defaultSearch, defaultSortBy, defaultSortDirection, viewKey],
  );
  const [searchValue, setSearchValue] = useState(defaultSearch);
  const [sortBy, setSortBy] = useState<TSort>(persistedState.sortBy);
  const [sortDirection, setSortDirection] = useState<ListSortDirection>(persistedState.sortDirection);
  const debouncedSearch = useDebouncedValue(searchValue.trim(), debounceMs);

  useEffect(() => {
    setSortBy(persistedState.sortBy);
    setSortDirection(persistedState.sortDirection);
    setSearchValue(defaultSearch);
  }, [defaultSearch, persistedState.sortBy, persistedState.sortDirection, viewKey]);

  useEffect(() => {
    writeJsonPreference(`list-controls:${viewKey}`, { sortBy, sortDirection });
  }, [sortBy, sortDirection, viewKey]);

  const resolveDefaultDirection = (field: TSort) => defaultDirectionBySort?.[field] ?? defaultSortDirection;

  const setSortField = (field: TSort) => {
    setSortBy(field);
    setSortDirection(resolveDefaultDirection(field));
  };

  const toggleSortDirection = () => {
    setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
  };

  const requestSort = (field: TSort) => {
    if (sortBy === field) {
      toggleSortDirection();
      return;
    }

    setSortField(field);
  };

  const activeSortOption = sortOptions.find((option) => option.value === sortBy) ?? null;
  const activeColumnKey = activeSortOption?.columnKey ?? null;

  const handleColumnSortRequest = (columnKey: string) => {
    const matchedOption = sortOptions.find((option) => option.columnKey === columnKey);

    if (!matchedOption) {
      return;
    }

    requestSort(matchedOption.value);
  };

  const query = useMemo(
    () =>
      buildQuery({
        search: debouncedSearch,
        sortBy,
        sortDirection,
      }),
    [buildQuery, debouncedSearch, sortBy, sortDirection],
  );

  return {
    query,
    searchValue,
    setSearchValue,
    sortBy,
    setSortField,
    sortDirection,
    toggleSortDirection,
    requestSort,
    activeSortOption,
    activeColumnKey,
    handleColumnSortRequest,
  };
};
