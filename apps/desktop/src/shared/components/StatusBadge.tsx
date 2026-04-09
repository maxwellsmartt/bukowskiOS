import type { ReactNode } from "react";

type StatusTone = "neutral" | "info" | "success" | "warning" | "critical";

type StatusBadgeProps = {
  tone?: StatusTone;
  children: ReactNode;
};

export const StatusBadge = ({ tone = "neutral", children }: StatusBadgeProps) => (
  <span className={`status-badge status-badge-${tone}`}>{children}</span>
);
