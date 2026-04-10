import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { readJsonPreference, writeJsonPreference } from "@shared/lib/preferences";

type DataColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: number;
  minWidth?: number;
  resizable?: boolean;
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
}: DataTableProps<T>) => {
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
    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeStateRef.current) {
        return;
      }

      const activeColumn = columns.find((column) => column.key === resizeStateRef.current?.columnKey);
      const minWidth = activeColumn?.minWidth ?? 88;
      const nextWidth = Math.max(minWidth, resizeStateRef.current.startWidth + (event.clientX - resizeStateRef.current.startX));

      setColumnWidths((currentWidths) => ({
        ...currentWidths,
        [resizeStateRef.current!.columnKey]: nextWidth,
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

  const allRowsSelected = resolvedRowIds.length > 0 && resolvedRowIds.every((rowId) => activeSelection.includes(rowId));
  const someRowsSelected = activeSelection.length > 0 && !allRowsSelected;

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

  return (
    <div
      className="table-shell"
      style={
        {
          "--table-max-height": resolveMaxHeight(maxHeight),
        } as CSSProperties
      }
    >
      <table className="data-table">
        <colgroup>
          {selectable ? <col style={{ width: selectionColumnWidth, minWidth: selectionColumnWidth }} /> : null}
          {columns.map((column) => (
            <col key={column.key} style={{ width: columnWidths[column.key], minWidth: column.minWidth ?? 88 }} />
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

            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "align-right" : ""}>
                <div className="data-table-header-cell">
                  <span>{column.label}</span>
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

                  {columns.map((column) => (
                    <td key={column.key} className={column.align === "right" ? "align-right" : ""}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="data-table-empty" colSpan={columns.length + (selectable ? 1 : 0)}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
