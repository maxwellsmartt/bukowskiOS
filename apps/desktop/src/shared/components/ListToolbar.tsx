import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CircleDot,
  FolderKanban,
  Hash,
  ListFilter,
  Search,
  TextCursorInput,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ListSortDirection } from "@contracts";

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
  rightActions?: ReactNode;
  showSortControl?: boolean;
};

const resolveSortOptionIcon = (value: string, label: string) => {
  const key = `${value} ${label}`.toLowerCase();

  if (key.includes("date") || key.includes("created") || key.includes("updated") || key.includes("start") || key.includes("end")) {
    return CalendarDays;
  }

  if (key.includes("code") || key.includes("number")) {
    return Hash;
  }

  if (key.includes("client") || key.includes("responsible") || key.includes("crew") || key.includes("user")) {
    return UserRound;
  }

  if (key.includes("project") || key.includes("category") || key.includes("type")) {
    return FolderKanban;
  }

  if (key.includes("status")) {
    return CircleDot;
  }

  return TextCursorInput;
};

type ListSortMenuButtonProps<TSort extends string> = {
  sortOptions: Array<ListToolbarOption<TSort>>;
  sortBy: TSort;
  sortDirection: ListSortDirection;
  onSortByChange: (value: TSort) => void;
  onToggleSortDirection: () => void;
  activeSortLabel?: string | null;
  className?: string;
};

export const ListSortMenuButton = <TSort extends string,>({
  sortOptions,
  sortBy,
  sortDirection,
  onSortByChange,
  onToggleSortDirection,
  activeSortLabel,
  className = "",
}: ListSortMenuButtonProps<TSort>) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; placement: "bottom" | "top" } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const activeOption = useMemo(() => sortOptions.find((option) => option.value === sortBy) ?? sortOptions[0], [sortBy, sortOptions]);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const updateMenuPosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const menuWidth = 184;
      const estimatedMenuHeight = 208;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const fitsBelow = rect.bottom + 8 + estimatedMenuHeight <= viewportHeight - 12;
      const placement = fitsBelow ? "bottom" : "top";
      const top = placement === "bottom" ? rect.bottom + 8 : Math.max(12, rect.top - estimatedMenuHeight - 8);
      const left = Math.max(12, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 12));

      setMenuStyle({ top, left, placement });
    };

    updateMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };

    const handleLayoutChange = () => updateMenuPosition();

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [menuOpen]);

  return (
    <div className="list-toolbar-menu-shell" ref={menuRef}>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={t("common.listToolbar.sortByAria", {
          label: activeSortLabel ?? activeOption?.label ?? t("common.listToolbar.selectedOption"),
        })}
        className={`ghost-control list-toolbar-menu-trigger${menuOpen ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        data-tooltip={t("common.listToolbar.sort")}
        onClick={() => setMenuOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <ListFilter aria-hidden size={14} />
      </button>

          {menuOpen && menuStyle
            ? createPortal(
                <div
                  className={`list-toolbar-menu list-toolbar-menu-${menuStyle.placement}`}
                  ref={menuRef}
                  role="menu"
                  style={{ top: menuStyle.top, left: menuStyle.left }}
                >
                  <div className="list-toolbar-menu-section">
                    <span className="list-toolbar-menu-label">{t("common.listToolbar.sortBy")}</span>
                    {sortOptions.map((option) => {
                      const Icon = resolveSortOptionIcon(String(option.value), option.label);
                      const active = option.value === sortBy;
                      return (
                        <button
                          key={option.value}
                          className={`list-toolbar-menu-item${active ? " is-active" : ""}`}
                          onClick={() => {
                            onSortByChange(option.value);
                            setMenuOpen(false);
                          }}
                          role="menuitemradio"
                          type="button"
                        >
                          <span className="list-toolbar-menu-item-copy">
                            <Icon aria-hidden size={14} />
                            <span>{option.label}</span>
                          </span>
                          {active ? <Check aria-hidden size={14} /> : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="list-toolbar-menu-divider" />

                  <div className="list-toolbar-menu-section">
                    <span className="list-toolbar-menu-label">{t("common.listToolbar.direction")}</span>
                    <button
                      className={`list-toolbar-menu-item${sortDirection === "asc" ? " is-active" : ""}`}
                      onClick={() => {
                        if (sortDirection !== "asc") {
                          onToggleSortDirection();
                        }
                        setMenuOpen(false);
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span className="list-toolbar-menu-item-copy">
                        <ArrowUp aria-hidden size={14} />
                        <span>{t("common.listToolbar.ascending")}</span>
                      </span>
                      {sortDirection === "asc" ? <Check aria-hidden size={14} /> : null}
                    </button>

                    <button
                      className={`list-toolbar-menu-item${sortDirection === "desc" ? " is-active" : ""}`}
                      onClick={() => {
                        if (sortDirection !== "desc") {
                          onToggleSortDirection();
                        }
                        setMenuOpen(false);
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span className="list-toolbar-menu-item-copy">
                        <ArrowDown aria-hidden size={14} />
                        <span>{t("common.listToolbar.descending")}</span>
                      </span>
                      {sortDirection === "desc" ? <Check aria-hidden size={14} /> : null}
                    </button>
                  </div>
                </div>,
                document.body,
              )
            : null}
    </div>
  );
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
  rightActions,
  showSortControl = true,
}: ListToolbarProps<TSort>) => {
  const { t } = useTranslation();
  const resultLabelSingular = resultLabel.replace(/s$/, "");
  const searchPlaceholderWithCount =
    typeof resultCount === "number" ? `${searchPlaceholder} (${resultCount} ${resultCount === 1 ? resultLabelSingular : resultLabel})` : searchPlaceholder;

  return (
    <div className="list-toolbar">
      <label className="list-toolbar-search" aria-label={t("common.listToolbar.searchAria")}>
        <Search aria-hidden size={14} />
        <input
          className="list-toolbar-search-input"
          onChange={(event) => onSearchValueChange(event.target.value)}
          placeholder={searchPlaceholderWithCount}
          type="search"
          value={searchValue}
        />
      </label>

      <div className="list-toolbar-controls">
        {rightActions ? <div className="list-toolbar-actions">{rightActions}</div> : null}
        {showSortControl ? (
          <ListSortMenuButton
            activeSortLabel={activeSortLabel}
            onSortByChange={onSortByChange}
            onToggleSortDirection={onToggleSortDirection}
            sortBy={sortBy}
            sortDirection={sortDirection}
            sortOptions={sortOptions}
          />
        ) : null}
      </div>
    </div>
  );
};
