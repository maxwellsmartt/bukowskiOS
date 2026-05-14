import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, Columns3, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ListSortDirection } from "@contracts";
import { readJsonPreference, writeJsonPreference } from "@shared/lib/preferences";

type DataColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: number;
  minWidth?: number;
  resizable?: boolean;
  hideable?: boolean;
  render: (row: T) => ReactNode;
};

type DataTableProps<T = unknown> = {
  columns: DataColumn<T>[];
  rows: T[];
  getRowId?: (row: T, index: number) => string;
  selectable?: boolean;
  selectedRowIds?: string[];
  onSelectedRowIdsChange?: (rowIds: string[]) => void;
  activeRowId?: string | null;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  maxHeight?: number | string;
  emptyMessage?: string;
  emptyContent?: ReactNode;
  persistKey?: string;
  defaultVisibleColumnKeys?: string[];
  shellClassName?: string;
  sortState?: {
    columnKey: string;
    direction: ListSortDirection;
  } | null;
  onSortRequest?: (columnKey: string) => void;
  autoScrollToActiveRow?: boolean;
  controlsAddon?: ReactNode;
  pruneSelectionOnRowsChange?: boolean;
};

const selectionColumnWidth = 44;
const columnReorderThreshold = 6;

const resolveMaxHeight = (value: DataTableProps["maxHeight"]) =>
  typeof value === "number" ? `${value}px` : value ?? "min(58vh, 620px)";

export const DataTable = <T = unknown,>({
  columns,
  rows,
  getRowId,
  selectable = false,
  selectedRowIds,
  onSelectedRowIdsChange,
  activeRowId = null,
  onRowClick,
  onRowDoubleClick,
  maxHeight,
  emptyMessage,
  emptyContent,
  persistKey,
  defaultVisibleColumnKeys,
  shellClassName,
  sortState = null,
  onSortRequest,
  autoScrollToActiveRow = false,
  controlsAddon,
  pruneSelectionOnRowsChange = true,
}: DataTableProps<T>) => {
  const { t } = useTranslation();
  const defaultMinColumnWidth = 56;
  const tableShellRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const resolvedRowIds = useMemo(
    () => rows.map((row, index) => (getRowId ? getRowId(row, index) : String(index))),
    [getRowId, rows],
  );

  const [internalSelectedRowIds, setInternalSelectedRowIds] = useState<string[]>([]);
  const activeSelection = selectedRowIds ?? internalSelectedRowIds;
  const resizeStateRef = useRef<{ columnKey: string; startX: number; startWidth: number } | null>(null);
  const columnReorderStateRef = useRef<{ columnKey: string; startX: number; startY: number; active: boolean } | null>(null);
  const suppressNextSortClickRef = useRef(false);
  const columnOrderUndoStackRef = useRef<string[][]>([]);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const parsedWidths = persistKey ? readJsonPreference<Record<string, number>>(`table:${persistKey}`, {}) : {};

    return columns.reduce<Record<string, number>>((accumulator, column) => {
      accumulator[column.key] = parsedWidths[column.key] ?? column.width ?? 160;
      return accumulator;
    }, {});
  });
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnsMenuStyle, setColumnsMenuStyle] = useState<{ top: number; left: number; placement: "bottom" | "top" } | null>(null);
  const [reorderState, setReorderState] = useState<{ draggedKey: string | null; overKey: string | null }>({
    draggedKey: null,
    overKey: null,
  });
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(() => {
    const defaultKeys = columns.map((column) => column.key);
    const preferredDefaultKeys = defaultVisibleColumnKeys?.filter((key) => defaultKeys.includes(key)) ?? defaultKeys;
    if (!persistKey) {
      return preferredDefaultKeys.length ? preferredDefaultKeys : defaultKeys;
    }

    const savedKeys = readJsonPreference<string[]>(`table-columns:${persistKey}`, preferredDefaultKeys);
    const validKeys = savedKeys.filter((key) => defaultKeys.includes(key));
    return validKeys.length ? validKeys : preferredDefaultKeys;
  });

  const setSelection = (nextSelection: string[]) => {
    if (onSelectedRowIdsChange) {
      onSelectedRowIdsChange(nextSelection);
      return;
    }

    setInternalSelectedRowIds(nextSelection);
  };

  useEffect(() => {
    if (!pruneSelectionOnRowsChange) {
      return;
    }

    const validRowIds = new Set(resolvedRowIds);
    const nextSelection = activeSelection.filter((rowId) => validRowIds.has(rowId));

    if (nextSelection.length !== activeSelection.length) {
      setSelection(nextSelection);
    }
  }, [activeSelection, pruneSelectionOnRowsChange, resolvedRowIds]);

  useEffect(() => {
    setColumnWidths((currentWidths) =>
      columns.reduce<Record<string, number>>((accumulator, column) => {
        accumulator[column.key] = currentWidths[column.key] ?? column.width ?? 160;
        return accumulator;
      }, {}),
    );
  }, [columns]);

  useEffect(() => {
    if (!persistKey || typeof window === "undefined") {
      return;
    }

    writeJsonPreference(`table:${persistKey}`, columnWidths);
  }, [columnWidths, persistKey]);

  useEffect(() => {
    const defaultKeys = columns.map((column) => column.key);
    setVisibleColumnKeys((currentKeys) => {
      const nextKeys = currentKeys.filter((key) => defaultKeys.includes(key));
      const fallbackKeys = defaultVisibleColumnKeys?.filter((key) => defaultKeys.includes(key)) ?? defaultKeys;
      const missingKeys = fallbackKeys.filter((key) => !nextKeys.includes(key));
      const resolvedKeys = [...nextKeys, ...missingKeys];
      return resolvedKeys.length ? resolvedKeys : fallbackKeys;
    });
  }, [columns, defaultVisibleColumnKeys]);

  useEffect(() => {
    if (!persistKey || typeof window === "undefined") {
      return;
    }

    writeJsonPreference(`table-columns:${persistKey}`, visibleColumnKeys);
  }, [persistKey, visibleColumnKeys]);

  useEffect(() => {
    if (!autoScrollToActiveRow || !activeRowId || !tableShellRef.current) {
      return;
    }

    const activeRow = tableShellRef.current.querySelector<HTMLTableRowElement>(`tr[data-row-id="${activeRowId}"]`);
    activeRow?.scrollIntoView({ block: "nearest" });
  }, [activeRowId, autoScrollToActiveRow, rows]);

  useEffect(() => {
    if (!persistKey) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (isEditableTarget || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "z") {
        return;
      }

      const previousOrder = columnOrderUndoStackRef.current.pop();

      if (!previousOrder) {
        return;
      }

      event.preventDefault();
      setVisibleColumnKeys(previousOrder);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [persistKey]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeStateRef.current;

      if (!resizeState) {
        return;
      }

      const activeColumn = columns.find((column) => column.key === resizeState.columnKey);
      const minWidth = activeColumn?.minWidth ?? defaultMinColumnWidth;
      const nextWidth = Math.max(minWidth, resizeState.startWidth + (event.clientX - resizeState.startX));

      setColumnWidths((currentWidths) => ({
        ...currentWidths,
        [resizeState.columnKey]: nextWidth,
      }));
    };

    const handleMouseUp = () => {
      resizeStateRef.current = null;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [columns]);

  useEffect(() => {
    if (!columnsMenuOpen) {
      return;
    }

    const updateMenuPosition = () => {
      const trigger = columnsTriggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const menuWidth = 184;
      const estimatedMenuHeight = 244;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const fitsBelow = rect.bottom + 8 + estimatedMenuHeight <= viewportHeight - 12;
      const placement = fitsBelow ? "bottom" : "top";
      const top = placement === "bottom" ? rect.bottom + 8 : Math.max(12, rect.top - estimatedMenuHeight - 8);
      const left = Math.max(12, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 12));

      setColumnsMenuStyle({ top, left, placement });
    };

    updateMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!columnsMenuRef.current?.contains(target) && !columnsTriggerRef.current?.contains(target)) {
        setColumnsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [columnsMenuOpen]);

  const allRowsSelected = resolvedRowIds.length > 0 && resolvedRowIds.every((rowId) => activeSelection.includes(rowId));
  const someRowsSelected =
    (pruneSelectionOnRowsChange
      ? activeSelection.length > 0
      : resolvedRowIds.some((rowId) => activeSelection.includes(rowId))) && !allRowsSelected;
  const visibleColumns = useMemo(() => {
    const resolvedKeys = visibleColumnKeys.filter((key) => columns.some((column) => column.key === key));
    const columnByKey = new Map(columns.map((column) => [column.key, column] as const));
    return resolvedKeys.map((key) => columnByKey.get(key)).filter((column): column is DataColumn<T> => Boolean(column));
  }, [columns, visibleColumnKeys]);
  const hideableColumns = columns.filter((column) => column.hideable !== false);
  const visibleHideableCount = visibleColumns.filter((column) => column.hideable !== false).length;
  const showColumnVisibilityControl = Boolean(persistKey) && hideableColumns.length > 1;

  const toggleRowSelection = (rowId: string, checked: boolean) => {
    if (checked) {
      setSelection(Array.from(new Set([...activeSelection, rowId])));
      return;
    }

    setSelection(activeSelection.filter((value) => value !== rowId));
  };

  const toggleAllRows = (checked: boolean) => {
    if (pruneSelectionOnRowsChange) {
      setSelection(checked ? resolvedRowIds : []);
      return;
    }

    const visibleRowIds = new Set(resolvedRowIds);
    setSelection(
      checked
        ? Array.from(new Set([...activeSelection, ...resolvedRowIds]))
        : activeSelection.filter((rowId) => !visibleRowIds.has(rowId)),
    );
  };

  const handleResizeStart = (event: ReactMouseEvent<HTMLButtonElement>, columnKey: string) => {
    event.preventDefault();
    event.stopPropagation();

    resizeStateRef.current = {
      columnKey,
      startX: event.clientX,
      startWidth: columnWidths[columnKey] ?? 160,
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const toggleColumnVisibility = (columnKey: string) => {
    setVisibleColumnKeys((current) => {
      const isVisible = current.includes(columnKey);
      if (isVisible) {
        const nextVisible = columns.filter((column) => column.hideable !== false && current.includes(column.key) && column.key !== columnKey);
        if (!nextVisible.length) {
          return current;
        }
        return current.filter((key) => key !== columnKey);
      }

      return [...current, columnKey];
    });
  };

  const moveVisibleColumn = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) {
      return;
    }

    setVisibleColumnKeys((currentKeys) => {
      const sourceIndex = currentKeys.indexOf(sourceKey);
      const targetIndex = currentKeys.indexOf(targetKey);

      if (sourceIndex === -1 || targetIndex === -1) {
        return currentKeys;
      }

      const nextKeys = [...currentKeys];
      const [movedKey] = nextKeys.splice(sourceIndex, 1);
      nextKeys.splice(targetIndex, 0, movedKey);
      columnOrderUndoStackRef.current = [...columnOrderUndoStackRef.current.slice(-9), currentKeys];
      return nextKeys;
    });
  };

  const handleColumnPointerDown = (event: ReactPointerEvent<HTMLElement>, columnKey: string) => {
    if (!persistKey || event.button !== 0 || resizeStateRef.current) {
      return;
    }

    columnReorderStateRef.current = {
      columnKey,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const handleColumnPointerMove = (event: ReactPointerEvent<HTMLElement>, columnKey: string) => {
    const dragState = columnReorderStateRef.current;

    if (!dragState) {
      return;
    }

    const distanceX = Math.abs(event.clientX - dragState.startX);
    const distanceY = Math.abs(event.clientY - dragState.startY);

    if (!dragState.active && Math.max(distanceX, distanceY) >= columnReorderThreshold) {
      dragState.active = true;
      document.body.classList.add("is-reordering-table-column");
      setReorderState({ draggedKey: dragState.columnKey, overKey: columnKey });
    }

    if (dragState.active) {
      event.preventDefault();
      setReorderState((current) => (current.overKey === columnKey ? current : { ...current, overKey: columnKey }));
    }
  };

  const handleColumnPointerUp = (event: ReactPointerEvent<HTMLElement>, columnKey: string) => {
    const dragState = columnReorderStateRef.current;

    if (!dragState) {
      return;
    }

    if (dragState.active) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextSortClickRef.current = true;
      moveVisibleColumn(dragState.columnKey, columnKey);
    }

    columnReorderStateRef.current = null;
    document.body.classList.remove("is-reordering-table-column");
    setReorderState({ draggedKey: null, overKey: null });
  };

  const cancelColumnReorder = () => {
    columnReorderStateRef.current = null;
    document.body.classList.remove("is-reordering-table-column");
    setReorderState({ draggedKey: null, overKey: null });
  };

  const handleColumnPointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    if (columnReorderStateRef.current?.active) {
      event.preventDefault();
    }
  };

  const handleSortClick = (event: ReactMouseEvent<HTMLButtonElement>, columnKey: string) => {
    if (reorderState.draggedKey || suppressNextSortClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextSortClickRef.current = false;
      return;
    }

    onSortRequest?.(columnKey);
  };

  return (
    <div className="data-table-stack">
      {showColumnVisibilityControl ? (
        <div className="data-table-columns-trigger-shell">
          {controlsAddon ? <div className="data-table-columns-extra-controls">{controlsAddon}</div> : null}
          <button
            aria-expanded={columnsMenuOpen}
            aria-haspopup="menu"
            aria-label={t("shared.dataTable.manageColumns")}
            className={`icon-ghost-control data-table-columns-trigger${columnsMenuOpen ? " is-open" : ""}`}
            data-tooltip={t("shared.dataTable.columns")}
            onClick={() => setColumnsMenuOpen((current) => !current)}
            ref={columnsTriggerRef}
            type="button"
          >
            <Columns3 size={14} />
          </button>
        </div>
      ) : null}
      <div
        ref={tableShellRef}
        className={`table-shell${shellClassName ? ` ${shellClassName}` : ""}`}
        style={
          {
            "--table-max-height": resolveMaxHeight(maxHeight),
          } as CSSProperties
        }
      >
        <table ref={tableRef} className="data-table">
        <colgroup>
          {selectable ? <col style={{ width: selectionColumnWidth, minWidth: selectionColumnWidth }} /> : null}
          {visibleColumns.map((column) => (
            <col key={column.key} style={{ width: columnWidths[column.key], minWidth: column.minWidth ?? defaultMinColumnWidth }} />
          ))}
        </colgroup>

        <thead>
          <tr>
            {selectable ? (
              <th className="data-table-select-cell">
                <input
                  aria-label={t("shared.dataTable.selectAllRows")}
                  checked={allRowsSelected}
                  className="table-checkbox"
                  onChange={(event) => toggleAllRows(event.target.checked)}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = someRowsSelected;
                    }
                  }}
                  type="checkbox"
                />
              </th>
            ) : null}

            {visibleColumns.map((column) => (
              <th
                key={column.key}
                aria-sort={
                  sortState?.columnKey === column.key
                    ? sortState.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className={[
                  column.align === "right" ? "align-right" : "",
                  sortState?.columnKey === column.key ? "data-table-sort-active" : "",
                  persistKey ? "data-table-column-reorderable" : "",
                  reorderState.draggedKey === column.key ? "data-table-column-dragging" : "",
                  reorderState.overKey === column.key && reorderState.draggedKey !== column.key ? "data-table-column-drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onPointerDown={(event) => handleColumnPointerDown(event, column.key)}
                onPointerCancel={cancelColumnReorder}
                onPointerLeave={handleColumnPointerLeave}
                onPointerMove={(event) => handleColumnPointerMove(event, column.key)}
                onPointerUp={(event) => handleColumnPointerUp(event, column.key)}
              >
                <div className="data-table-header-cell">
                  {onSortRequest ? (
                    <button className="data-table-sort-button" onClick={(event) => handleSortClick(event, column.key)} type="button">
                      <span>{column.label}</span>
                      {sortState?.columnKey === column.key ? (
                        <span className="data-table-sort-indicator">{sortState.direction === "asc" ? "↑" : "↓"}</span>
                      ) : null}
                    </button>
                  ) : (
                    <span className="data-table-header-label">
                      <span>{column.label}</span>
                      {sortState?.columnKey === column.key ? (
                        <span className="data-table-sort-indicator">{sortState.direction === "asc" ? "↑" : "↓"}</span>
                      ) : null}
                    </span>
                  )}
                  {column.resizable === false ? null : (
                    <button
                      aria-label={t("shared.dataTable.resizeColumn", { label: column.label })}
                      className="column-resizer"
                      onMouseDown={(event) => handleResizeStart(event, column.key)}
                      type="button"
                    />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length ? (
            rows.map((row, index) => {
              const rowId = resolvedRowIds[index];
              const isActive = activeRowId === rowId;
              const isSelected = activeSelection.includes(rowId);

              return (
                <tr
                  key={rowId}
                  data-row-id={rowId}
                  className={[
                    onRowClick || onRowDoubleClick ? "data-table-row-clickable" : "",
                    isActive ? "data-table-row-active" : "",
                    isSelected ? "data-table-row-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onRowClick?.(row)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                >
                  {selectable ? (
                    <td className="data-table-select-cell" onClick={(event) => event.stopPropagation()}>
                      <input
                        aria-label={t("shared.dataTable.selectRow", { index: index + 1 })}
                        checked={isSelected}
                        className="table-checkbox"
                        onChange={(event) => toggleRowSelection(rowId, event.target.checked)}
                        type="checkbox"
                      />
                    </td>
                  ) : null}

                  {visibleColumns.map((column) => (
                    <td key={column.key} className={column.align === "right" ? "align-right" : ""}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="data-table-empty" colSpan={visibleColumns.length + (selectable ? 1 : 0)}>
                {emptyContent ?? emptyMessage ?? t("shared.dataTable.empty")}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
      {columnsMenuOpen && columnsMenuStyle && showColumnVisibilityControl
        ? createPortal(
            <div
              className={`list-toolbar-menu list-toolbar-menu-${columnsMenuStyle.placement} data-table-columns-menu`}
              ref={columnsMenuRef}
              role="menu"
              style={{ top: columnsMenuStyle.top, left: columnsMenuStyle.left }}
            >
              <div className="list-toolbar-menu-section">
                <span className="list-toolbar-menu-label">{t("shared.dataTable.columns")}</span>
                {columns.map((column) => {
                  const isVisible = visibleColumnKeys.includes(column.key);
                  const locked = column.hideable === false;
                  return (
                    <button
                      key={column.key}
                      className={`list-toolbar-menu-item${isVisible ? " is-active" : ""}`}
                      disabled={locked || (isVisible && visibleHideableCount === 1 && column.hideable !== false)}
                      onClick={() => toggleColumnVisibility(column.key)}
                      role="menuitemcheckbox"
                      type="button"
                    >
                      <span className="list-toolbar-menu-item-copy">
                        <span>{column.label}</span>
                      </span>
                      {isVisible ? <Check aria-hidden size={14} /> : null}
                    </button>
                  );
                })}
              </div>

              <div className="list-toolbar-menu-divider" />

              <div className="list-toolbar-menu-section">
                <button
                  className="list-toolbar-menu-item"
                  onClick={() => {
                    const defaultKeys = columns.map((column) => column.key);
                    const preferredDefaultKeys = defaultVisibleColumnKeys?.filter((key) => defaultKeys.includes(key)) ?? defaultKeys;
                    setVisibleColumnKeys(preferredDefaultKeys.length ? preferredDefaultKeys : defaultKeys);
                    setColumnsMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="list-toolbar-menu-item-copy">
                    <RotateCcw aria-hidden size={14} />
                    <span>{t("shared.dataTable.resetColumns")}</span>
                  </span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
