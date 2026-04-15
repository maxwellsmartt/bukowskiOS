import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, Columns3, RotateCcw } from "lucide-react";

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
  persistKey?: string;
  shellClassName?: string;
  persistentHorizontalScroll?: boolean;
  sortState?: {
    columnKey: string;
    direction: ListSortDirection;
  } | null;
  onSortRequest?: (columnKey: string) => void;
  autoScrollToActiveRow?: boolean;
  controlsAddon?: ReactNode;
};

const selectionColumnWidth = 44;

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
  emptyMessage = "No rows available.",
  persistKey,
  shellClassName,
  persistentHorizontalScroll = false,
  sortState = null,
  onSortRequest,
  autoScrollToActiveRow = false,
  controlsAddon,
}: DataTableProps<T>) => {
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

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const parsedWidths = persistKey ? readJsonPreference<Record<string, number>>(`table:${persistKey}`, {}) : {};

    return columns.reduce<Record<string, number>>((accumulator, column) => {
      accumulator[column.key] = parsedWidths[column.key] ?? column.width ?? 160;
      return accumulator;
    }, {});
  });
  const [horizontalScrollMetrics, setHorizontalScrollMetrics] = useState({
    hasOverflow: false,
    maxScrollLeft: 0,
    scrollLeft: 0,
  });
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnsMenuStyle, setColumnsMenuStyle] = useState<{ top: number; left: number; placement: "bottom" | "top" } | null>(null);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(() => {
    const defaultKeys = columns.map((column) => column.key);
    if (!persistKey) {
      return defaultKeys;
    }

    const savedKeys = readJsonPreference<string[]>(`table-columns:${persistKey}`, defaultKeys);
    const validKeys = savedKeys.filter((key) => defaultKeys.includes(key));
    return validKeys.length ? validKeys : defaultKeys;
  });

  const setSelection = (nextSelection: string[]) => {
    if (onSelectedRowIdsChange) {
      onSelectedRowIdsChange(nextSelection);
      return;
    }

    setInternalSelectedRowIds(nextSelection);
  };

  useEffect(() => {
    const validRowIds = new Set(resolvedRowIds);
    const nextSelection = activeSelection.filter((rowId) => validRowIds.has(rowId));

    if (nextSelection.length !== activeSelection.length) {
      setSelection(nextSelection);
    }
  }, [activeSelection, resolvedRowIds]);

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
      const missingKeys = defaultKeys.filter((key) => !nextKeys.includes(key));
      const resolvedKeys = [...nextKeys, ...missingKeys];
      return resolvedKeys.length ? resolvedKeys : defaultKeys;
    });
  }, [columns]);

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
    if (!persistentHorizontalScroll) {
      return;
    }

    const shell = tableShellRef.current;
    const table = tableRef.current;

    if (!shell || !table) {
      return;
    }

    const updateMetrics = () => {
      const maxScrollLeft = Math.max(0, table.scrollWidth - shell.clientWidth);
      const hasOverflow = maxScrollLeft > 2;
      setHorizontalScrollMetrics({
        hasOverflow,
        maxScrollLeft,
        scrollLeft: Math.min(shell.scrollLeft, maxScrollLeft),
      });
    };

    updateMetrics();

    const resizeObserver = new ResizeObserver(() => {
      updateMetrics();
    });

    resizeObserver.observe(shell);
    resizeObserver.observe(table);

    return () => {
      resizeObserver.disconnect();
    };
  }, [columns, columnWidths, persistentHorizontalScroll, rows]);

  useEffect(() => {
    if (!persistentHorizontalScroll) {
      return;
    }

    const shell = tableShellRef.current;

    if (!shell) {
      return;
    }

    const handleShellScroll = () => {
      setHorizontalScrollMetrics((current) => ({
        ...current,
        scrollLeft: shell.scrollLeft,
      }));
    };

    shell.addEventListener("scroll", handleShellScroll, { passive: true });

    return () => {
      shell.removeEventListener("scroll", handleShellScroll);
    };
  }, [persistentHorizontalScroll]);

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
      const menuWidth = 220;
      const estimatedMenuHeight = 280;
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
  const someRowsSelected = activeSelection.length > 0 && !allRowsSelected;
  const visibleColumns = useMemo(() => {
    const resolvedKeys = visibleColumnKeys.filter((key) => columns.some((column) => column.key === key));
    return columns.filter((column) => resolvedKeys.includes(column.key));
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
    setSelection(checked ? resolvedRowIds : []);
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

      return columns.filter((column) => current.includes(column.key) || column.key === columnKey).map((column) => column.key);
    });
  };

  return (
    <div className="data-table-stack">
      {showColumnVisibilityControl ? (
        <div className="data-table-columns-trigger-shell">
          {controlsAddon ? <div className="data-table-columns-extra-controls">{controlsAddon}</div> : null}
          <button
            aria-expanded={columnsMenuOpen}
            aria-haspopup="menu"
            aria-label="Manage visible columns"
            className={`icon-ghost-control data-table-columns-trigger${columnsMenuOpen ? " is-open" : ""}`}
            data-tooltip="Columns"
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
                  aria-label="Select all rows"
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
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="data-table-header-cell">
                  {onSortRequest ? (
                    <button className="data-table-sort-button" onClick={() => onSortRequest(column.key)} type="button">
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
                      aria-label={`Resize ${column.label} column`}
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
                        aria-label={`Select row ${index + 1}`}
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
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
      {persistentHorizontalScroll && horizontalScrollMetrics.hasOverflow ? (
        <label className="data-table-horizontal-range-shell">
          <span className="sr-only">Horizontal table scroll</span>
          <input
            aria-label="Horizontal table scroll"
            className="data-table-horizontal-range"
            max={horizontalScrollMetrics.maxScrollLeft}
            min={0}
            onChange={(event) => {
              const nextScrollLeft = Number(event.target.value);
              setHorizontalScrollMetrics((current) => ({
                ...current,
                scrollLeft: nextScrollLeft,
              }));

              if (tableShellRef.current) {
                tableShellRef.current.scrollLeft = nextScrollLeft;
              }
            }}
            type="range"
            value={horizontalScrollMetrics.scrollLeft}
          />
        </label>
      ) : null}
      {columnsMenuOpen && columnsMenuStyle && showColumnVisibilityControl
        ? createPortal(
            <div
              className={`list-toolbar-menu list-toolbar-menu-${columnsMenuStyle.placement} data-table-columns-menu`}
              ref={columnsMenuRef}
              role="menu"
              style={{ top: columnsMenuStyle.top, left: columnsMenuStyle.left }}
            >
              <div className="list-toolbar-menu-section">
                <span className="list-toolbar-menu-label">Columns</span>
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
                    setVisibleColumnKeys(columns.map((column) => column.key));
                    setColumnsMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="list-toolbar-menu-item-copy">
                    <RotateCcw aria-hidden size={14} />
                    <span>Reset columns</span>
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
