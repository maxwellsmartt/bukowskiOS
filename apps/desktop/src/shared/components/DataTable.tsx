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

/**
 * A single entry in a row's right-click context menu. Modelled to map cleanly
 * onto a future TanStack Table migration (row passed back to onSelect).
 */
export type DataTableRowAction<T> = {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Render a divider above this item. */
  separatorBefore?: boolean;
  onSelect: (row: T) => void;
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
  fitToColumnWidths?: boolean;
  fillRemainingColumnKey?: string;
  /**
   * Fill the parent's remaining height via flexbox instead of measuring a
   * scroll container. The parent must be a flex column with a bounded height;
   * the table then scrolls internally and the page never scrolls. Avoids the
   * adaptive-measurement feedback loop that grew the table on remount.
   */
  fillParent?: boolean;
  /**
   * Build the right-click context menu for a row. Return an empty array (or
   * omit the prop) to disable the menu for a given row. The native browser
   * menu is suppressed only when at least one action is returned.
   */
  rowActions?: (row: T) => DataTableRowAction<T>[];
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
  fillRemainingColumnKey,
  fillParent = false,
  rowActions,
}: DataTableProps<T>) => {
  const { t } = useTranslation();
  const defaultMinColumnWidth = 56;
  const tableShellRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const colRefs = useRef<Record<string, HTMLTableColElement | null>>({});
  const resizeRafRef = useRef<number | null>(null);
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
  const selectionAnchorRowIdRef = useRef<string | null>(null);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const parsedWidths = persistKey ? readJsonPreference<Record<string, number>>(`table:${persistKey}`, {}) : {};

    return columns.reduce<Record<string, number>>((accumulator, column) => {
      accumulator[column.key] = parsedWidths[column.key] ?? column.width ?? 160;
      return accumulator;
    }, {});
  });
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnsMenuStyle, setColumnsMenuStyle] = useState<{ top: number; left: number; placement: "bottom" | "top" } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ row: T; rowId: string; x: number; y: number } | null>(null);
  const [tableShellWidth, setTableShellWidth] = useState(0);
  const [autoMaxHeight, setAutoMaxHeight] = useState<string | null>(null);
  const [reorderState, setReorderState] = useState<{ draggedKey: string | null; overKey: string | null }>({
    draggedKey: null,
    overKey: null,
  });
  const [resizingColumnKey, setResizingColumnKey] = useState<string | null>(null);
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

  // Track the shell width so columns can fill it (single, clean table; no
  // spurious horizontal scroll). Runs for every table, not just opt-in ones.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const tableShell = tableShellRef.current;

    if (!tableShell) {
      return;
    }

    const updateWidth = () => {
      setTableShellWidth(tableShell.clientWidth);
    };
    const observer = new ResizeObserver(updateWidth);
    observer.observe(tableShell);
    updateWidth();

    return () => {
      observer.disconnect();
    };
  }, []);

  // Adaptive height: when no explicit maxHeight is given, the table fills the
  // remaining space of its scroll container down to its visible bottom, so the
  // page itself does not scroll — only the table does. We measure relative to
  // the scroll container (its clientHeight minus the table's offset within the
  // scrolled content) so the value is STABLE while scrolling: otherwise reading
  // a live viewport top would make the table grow as the page scrolls.
  useEffect(() => {
    if (maxHeight !== undefined || fillParent || typeof window === "undefined") {
      return;
    }

    // Small breathing room below the table edge when there is no scroll
    // container padding to lean on.
    const fallbackGap = 16;
    const findScrollParent = (element: HTMLElement | null): HTMLElement | null => {
      let node = element?.parentElement ?? null;
      while (node) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    };

    const recompute = () => {
      const shell = tableShellRef.current;
      if (!shell) {
        return;
      }
      const shellRect = shell.getBoundingClientRect();
      const scrollParent = findScrollParent(shell);
      let available: number;
      if (scrollParent) {
        const parentStyle = window.getComputedStyle(scrollParent);
        const parentRect = scrollParent.getBoundingClientRect();
        const borderTop = parseFloat(parentStyle.borderTopWidth) || 0;
        const paddingBottom = parseFloat(parentStyle.paddingBottom) || 0;
        // Offset of the shell within the scroll container's content box (stable
        // under scroll: shellRect.top falls and scrollTop rises in lockstep).
        const offsetWithinContent =
          shellRect.top - parentRect.top + scrollParent.scrollTop - borderTop;
        // Subtract the container's own bottom padding so the table edge lands
        // exactly on the visible content bottom — no residual outer scroll.
        available = scrollParent.clientHeight - offsetWithinContent - paddingBottom;
      } else {
        available = window.innerHeight - shellRect.top - fallbackGap;
      }
      setAutoMaxHeight(`${Math.round(Math.max(220, available))}px`);
    };

    recompute();
    window.addEventListener("resize", recompute);
    const scrollParent = findScrollParent(tableShellRef.current);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(recompute) : null;
    if (scrollParent) {
      observer?.observe(scrollParent);
    }

    return () => {
      window.removeEventListener("resize", recompute);
      observer?.disconnect();
    };
  }, [maxHeight, fillParent, rows.length]);

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

  useEffect(
    () => () => {
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    },
    [],
  );

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

  // Row context menu: keep it inside the viewport and close on outside
  // interaction, Escape, scroll or resize.
  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const clampToViewport = () => {
      const menu = contextMenuRef.current;
      if (!menu) {
        return;
      }
      const rect = menu.getBoundingClientRect();
      const margin = 8;
      let nextX = contextMenu.x;
      let nextY = contextMenu.y;
      if (rect.right > window.innerWidth - margin) {
        nextX = Math.max(margin, window.innerWidth - rect.width - margin);
      }
      if (rect.bottom > window.innerHeight - margin) {
        nextY = Math.max(margin, window.innerHeight - rect.height - margin);
      }
      if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
        setContextMenu((current) => (current ? { ...current, x: nextX, y: nextY } : current));
      }
    };

    clampToViewport();

    const close = () => setContextMenu(null);
    const handlePointerDown = (event: MouseEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

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
  const baseColumnWidths = visibleColumns.reduce<Record<string, number>>((accumulator, column) => {
    accumulator[column.key] = columnWidths[column.key] ?? column.width ?? 160;
    return accumulator;
  }, {});
  const baseTableWidth = visibleColumns.reduce(
    (totalWidth, column) => totalWidth + (columnWidths[column.key] ?? column.width ?? 160),
    selectable ? selectionColumnWidth : 0,
  );
  // Fill the shell width by default so tables read as one cohesive block: when
  // the shell is wider than the columns, push the slack into the configured
  // fill column, else spread it proportionally across resizable columns.
  const widthSlack = tableShellWidth > 0 ? tableShellWidth - baseTableWidth : 0;
  const resolvedColumnWidths = (() => {
    if (widthSlack <= 0) {
      return baseColumnWidths;
    }
    // Absorb the slack in a single column (the configured one, else the last
    // visible) so resizing any other column doesn't shift its neighbours.
    const fillKey =
      fillRemainingColumnKey && baseColumnWidths[fillRemainingColumnKey] != null
        ? fillRemainingColumnKey
        : visibleColumns[visibleColumns.length - 1]?.key;
    if (!fillKey || baseColumnWidths[fillKey] == null) {
      return baseColumnWidths;
    }
    return { ...baseColumnWidths, [fillKey]: (baseColumnWidths[fillKey] ?? 0) + widthSlack };
  })();
  const tableWidth = visibleColumns.reduce(
    (totalWidth, column) => totalWidth + (resolvedColumnWidths[column.key] ?? column.width ?? 160),
    selectable ? selectionColumnWidth : 0,
  );

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

  const replaceSelectionWithRow = (rowId: string, isSelected: boolean) => {
    setSelection(isSelected && activeSelection.length === 1 ? [] : [rowId]);
  };

  const toggleAdditiveSelection = (rowId: string, isSelected: boolean) => {
    toggleRowSelection(rowId, !isSelected);
  };

  const selectRowRange = (rowId: string) => {
    const anchorRowId = selectionAnchorRowIdRef.current;
    const anchorIndex = anchorRowId ? resolvedRowIds.indexOf(anchorRowId) : -1;
    const rowIndex = resolvedRowIds.indexOf(rowId);

    if (anchorIndex === -1 || rowIndex === -1) {
      setSelection([rowId]);
      selectionAnchorRowIdRef.current = rowId;
      return;
    }

    const [startIndex, endIndex] = anchorIndex < rowIndex ? [anchorIndex, rowIndex] : [rowIndex, anchorIndex];
    const rangeRowIds = resolvedRowIds.slice(startIndex, endIndex + 1);
    setSelection(Array.from(new Set([...activeSelection, ...rangeRowIds])));
  };

  const applyRowSelectionGesture = (event: ReactMouseEvent<HTMLElement>, rowId: string, isSelected: boolean) => {
    if (event.shiftKey) {
      selectRowRange(rowId);
      return;
    }

    if (event.altKey || event.metaKey) {
      toggleAdditiveSelection(rowId, isSelected);
      selectionAnchorRowIdRef.current = rowId;
      return;
    }

    replaceSelectionWithRow(rowId, isSelected);
    selectionAnchorRowIdRef.current = rowId;
  };

  const shouldIgnoreRowSelection = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return Boolean(
      target.closest(
        [
          "button",
          "a",
          "input",
          "label",
          "select",
          "textarea",
          "[role='button']",
          "[role='menuitem']",
          "[role='menuitemcheckbox']",
          "[data-prevent-row-selection]",
          "[data-table-row-action]",
        ].join(","),
      ),
    );
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLTableRowElement>, row: T, rowId: string, isSelected: boolean) => {
    onRowClick?.(row);

    if (!selectable || event.detail > 1 || shouldIgnoreRowSelection(event.target)) {
      return;
    }

    applyRowSelectionGesture(event, rowId, isSelected);
  };

  const handleResizeStart = (event: ReactPointerEvent<HTMLButtonElement>, columnKey: string) => {
    event.preventDefault();
    event.stopPropagation();

    const column = columns.find((item) => item.key === columnKey);
    const minWidth = column?.minWidth ?? defaultMinColumnWidth;
    const startX = event.clientX;
    const startWidth = resolvedColumnWidths[columnKey] ?? columnWidths[columnKey] ?? 160;
    const startTableWidth = tableRef.current?.getBoundingClientRect().width ?? tableWidth;
    const resizer = event.currentTarget;
    let latestWidth = startWidth;

    resizeStateRef.current = { columnKey, startX, startWidth };
    setResizingColumnKey(columnKey);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    resizer.setPointerCapture(event.pointerId);

    // During the drag we mutate the <col> and table width directly (no React
    // state) so rows never re-render — the gesture feels fluid. We commit the
    // final width to state (and persistence) on release.
    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
      if (resizeRafRef.current != null) {
        return;
      }
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        const col = colRefs.current[columnKey];
        if (col) {
          col.style.width = `${latestWidth}px`;
        }
        if (tableRef.current) {
          const nextTableWidth = startTableWidth + (latestWidth - startWidth);
          tableRef.current.style.width = `${nextTableWidth}px`;
          tableRef.current.style.minWidth = `${nextTableWidth}px`;
        }
      });
    };

    const finish = (endEvent: PointerEvent) => {
      resizer.removeEventListener("pointermove", handlePointerMove);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
      if (resizer.hasPointerCapture(endEvent.pointerId)) {
        resizer.releasePointerCapture(endEvent.pointerId);
      }
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      resizeStateRef.current = null;
      setResizingColumnKey(null);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      setColumnWidths((currentWidths) => ({ ...currentWidths, [columnKey]: latestWidth }));
    };

    resizer.addEventListener("pointermove", handlePointerMove);
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
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
    <div className={`data-table-stack${fillParent ? " data-table-stack--fill" : ""}`}>
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
        className={`table-shell${fillParent ? " table-shell--fill" : ""}${shellClassName ? ` ${shellClassName}` : ""}`}
        style={
          {
            "--table-max-height": fillParent
              ? "none"
              : maxHeight !== undefined
                ? resolveMaxHeight(maxHeight)
                : autoMaxHeight ?? resolveMaxHeight(undefined),
          } as CSSProperties
        }
      >
        <table
          ref={tableRef}
          className="data-table"
          style={{ minWidth: tableWidth, width: tableWidth }}
        >
        <colgroup>
          {selectable ? <col style={{ width: selectionColumnWidth, minWidth: selectionColumnWidth }} /> : null}
          {visibleColumns.map((column) => (
            <col
              key={column.key}
              ref={(element) => {
                colRefs.current[column.key] = element;
              }}
              style={{ width: resolvedColumnWidths[column.key], minWidth: column.minWidth ?? defaultMinColumnWidth }}
            />
          ))}
        </colgroup>

        <thead>
          <tr>
            {selectable ? (
              <th
                className="data-table-select-cell"
                data-tooltip={t("shared.dataTable.selectionHint")}
                title={t("shared.dataTable.selectionHint")}
              >
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
                  column.resizable === false ? "" : "data-table-column-resizable",
                  resizingColumnKey === column.key ? "data-table-column-resizing" : "",
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
                      onPointerDown={(event) => handleResizeStart(event, column.key)}
                      title={t("shared.dataTable.resizeColumn", { label: column.label })}
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
                  onMouseDown={(event) => {
                    // Shift/modifier-click for range or additive selection
                    // would otherwise extend the browser's text selection across
                    // cells. Suppress that default for selectable tables.
                    if (selectable && (event.shiftKey || event.altKey || event.metaKey)) {
                      event.preventDefault();
                    }
                  }}
                  onClick={(event) => handleRowClick(event, row, rowId, isSelected)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  onContextMenu={(event) => {
                    if (!rowActions) {
                      return;
                    }
                    const actions = rowActions(row);
                    if (!actions.length) {
                      return;
                    }
                    event.preventDefault();
                    setColumnsMenuOpen(false);
                    setContextMenu({ row, rowId, x: event.clientX, y: event.clientY });
                  }}
                >
                  {selectable ? (
                    <td className="data-table-select-cell" onClick={(event) => event.stopPropagation()}>
                      <input
                        aria-label={t("shared.dataTable.selectRow", { index: index + 1 })}
                        checked={isSelected}
                        className="table-checkbox"
                        onChange={(event) => {
                          toggleRowSelection(rowId, event.target.checked);
                          selectionAnchorRowIdRef.current = rowId;
                        }}
                        onClick={(event) => {
                          if (!event.shiftKey && !event.altKey && !event.metaKey) {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          applyRowSelectionGesture(event, rowId, isSelected);
                        }}
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
      {contextMenu && rowActions
        ? createPortal(
            <div
              className="list-toolbar-menu list-toolbar-menu-bottom data-table-context-menu"
              ref={contextMenuRef}
              role="menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
            >
              <div className="list-toolbar-menu-section">
                {rowActions(contextMenu.row).map((action) => (
                  <div key={action.key}>
                    {action.separatorBefore ? <div className="list-toolbar-menu-divider" /> : null}
                    <button
                      className={`list-toolbar-menu-item${action.tone === "danger" ? " is-danger" : ""}`}
                      disabled={action.disabled}
                      onClick={() => {
                        const { row } = contextMenu;
                        setContextMenu(null);
                        action.onSelect(row);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <span className="list-toolbar-menu-item-copy">
                        {action.icon ? <span aria-hidden>{action.icon}</span> : null}
                        <span>{action.label}</span>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
