import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

type AgentCreatedBadgeProps = {
  label?: string;
  variant?: "inline" | "corner" | "table";
};

export const AgentCreatedBadge = ({ label, variant = "inline" }: AgentCreatedBadgeProps) => {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t("shared.agentCreatedBadge");

  return (
    <span
      className={`agent-created-badge agent-created-badge-${variant}`}
      role="img"
      aria-label={resolvedLabel}
      data-tooltip={resolvedLabel}
    >
      <Bot size={12} aria-hidden="true" />
    </span>
  );
};
