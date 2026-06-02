import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type StatusTone = "neutral" | "info" | "success" | "warning" | "critical";

type StatusBadgeProps = {
  tone?: StatusTone;
  /** Optional leading icon (Lucide). Sized to match the label automatically. */
  icon?: LucideIcon;
  /** Spin the icon — for in-progress states like "processing". */
  spin?: boolean;
  children: ReactNode;
};

export const StatusBadge = ({ tone = "neutral", icon: Icon, spin = false, children }: StatusBadgeProps) => (
  <span className={`status-badge status-badge-${tone}`}>
    {Icon ? <Icon className={`status-badge-icon${spin ? " status-badge-icon-spin" : ""}`} size={12} aria-hidden /> : null}
    {children}
  </span>
);
