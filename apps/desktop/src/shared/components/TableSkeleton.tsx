import type { CSSProperties } from "react";

type TableSkeletonProps = {
  rows?: number;
  columns?: number;
  title?: string;
  body?: string;
};

export const TableSkeleton = ({
  rows = 6,
  columns = 5,
  title = "Loading data",
  body = "Preparing the latest local snapshot for this view.",
}: TableSkeletonProps) => (
  <div
    className="table-skeleton-shell"
    aria-busy="true"
    aria-live="polite"
    style={
      {
        "--table-skeleton-columns": columns,
      } as CSSProperties
    }
  >
    <div className="table-skeleton-header">
      <div className="loading-line loading-line-title" />
      <div className="loading-line loading-line-subtle" />
      <span className="table-skeleton-title">{title}</span>
      <span className="table-skeleton-body">{body}</span>
    </div>

    <div className="table-skeleton-grid">
      <div className="table-skeleton-row table-skeleton-row-header">
        {Array.from({ length: columns }).map((_, index) => (
          <span key={`header-${index}`} className="loading-line table-skeleton-cell" />
        ))}
      </div>

      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={`row-${rowIndex}`} className="table-skeleton-row">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <span key={`cell-${rowIndex}-${columnIndex}`} className="loading-line table-skeleton-cell" />
          ))}
        </div>
      ))}
    </div>
  </div>
);
