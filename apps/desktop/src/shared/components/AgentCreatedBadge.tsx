import { Bot } from "lucide-react";

type AgentCreatedBadgeProps = {
  label?: string;
  variant?: "inline" | "corner" | "table";
};

export const AgentCreatedBadge = ({ label = "Created by agent", variant = "inline" }: AgentCreatedBadgeProps) => (
  <span
    className={`agent-created-badge agent-created-badge-${variant}`}
    role="img"
    aria-label={label}
    data-tooltip={label}
  >
    <Bot size={12} aria-hidden="true" />
  </span>
);
