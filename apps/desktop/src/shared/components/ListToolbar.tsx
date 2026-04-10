import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";

import type { ListSortDirection } from "@contracts";

import { SelectField } from "./SelectField";

type ListToolbarOption<TSort extends string> = {
  value: TSort;
  label: string;
};

type ListToolbarProps<TSort extends string> = {
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  searchPlaceholder: string;
  sortOptions: Array<ListToolbarOption<TSort>>;
  sortBy: TSort;
  sortDirection: ListSortDirection;
  onSortByChange: (value: TSort) => void;
  onToggleSortDirection: () => void;
  resultCount?: number;
  resultLabel?: string;
  activeSortLabel?: string | null;
};

export const ListToolbar = <TSort extends string,>({
  searchValue,
  onSearchValueChange,
  searchPlaceholder,
  sortOptions,
  sortBy,
  sortDirection,
  onSortByChange,
  onToggleSortDirection,
  resultCount,
  resultLabel = "results",
  activeSortLabel,
}: ListToolbarProps<TSort>) => (
  <div className="list-toolbar">
    <label className="list-toolbar-search" aria-label="Search current view">
      <Search aria-hidden size={14} />
      <input
        className="list-toolbar-search-input"
        onChange={(event) => onSearchValueChange(event.target.value)}
        placeholder={searchPlaceholder}
        type="search"
        value={searchValue}
      />
    </label>

    <div className="list-toolbar-controls">
      <div className="list-toolbar-sort-group">
        <div className="list-toolbar-sort-select">
          <ArrowUpDown aria-hidden size={14} />
          <SelectField
            aria-label="Sort rows"
            className="list-toolbar-sort-control"
            onChange={(event) => onSortByChange(event.target.value as TSort)}
            value={sortBy}
            wrapperClassName="list-toolbar-select-shell"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </div>

        <button
          aria-label={sortDirection === "asc" ? "Switch to descending order" : "Switch to ascending order"}
          className="ghost-control list-toolbar-direction"
          onClick={onToggleSortDirection}
          type="button"
        >
          {sortDirection === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          <span>{sortDirection === "asc" ? "Ascending" : "Descending"}</span>
        </button>
      </div>

      <div className="list-toolbar-meta">
        {activeSortLabel ? <span className="list-toolbar-pill">Sorted by {activeSortLabel}</span> : null}
        {typeof resultCount === "number" ? (
          <span className="list-toolbar-count">
            {resultCount} {resultCount === 1 ? resultLabel.replace(/s$/, "") : resultLabel}
          </span>
        ) : null}
      </div>
    </div>
  </div>
);
