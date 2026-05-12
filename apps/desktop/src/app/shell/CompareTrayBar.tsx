import { Scale, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useCompareTray } from "@app/providers/CompareTrayContext";

type CompareEntityType = "asset" | "project" | "financial_entry";

export const CompareTrayBar = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { clear, compatibleItems, compatibleType, groups, items, reasonDisabled, removeItem } = useCompareTray();

  if (!items.length) {
    return null;
  }

  const typeLabel = (type: CompareEntityType) => t(`shell.compareTray.types.${type}`);

  return (
    <aside className="compare-tray">
      <div className="compare-tray-header">
        <div>
          <h3 className="compare-tray-title">{t("shell.compareTray.title")}</h3>
        </div>

        <div className="compare-tray-actions">
          <button
            className="ghost-control"
            disabled={!compatibleType || compatibleItems.length < 2}
            data-tooltip={reasonDisabled ?? t("shell.compareTray.compareTooltipFallback")}
            onClick={() => {
              if (!compatibleType || compatibleItems.length < 2) {
                return;
              }

              navigate(`/compare?type=${compatibleType}`);
            }}
            type="button"
          >
            <Scale size={14} />
            <span>
              {compatibleType && compatibleItems.length >= 2
                ? t("shell.compareTray.compare", {
                    type: typeLabel(compatibleType),
                    count: compatibleItems.length,
                  })
                : t("shell.compareTray.compareUnavailable")}
            </span>
          </button>
          <button
            aria-label={t("shell.compareTray.clearAria")}
            className="icon-ghost-control is-danger"
            data-tooltip={t("shell.compareTray.clearTooltip")}
            onClick={clear}
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="compare-tray-groups">
        {groups.map((group) => (
          <div key={group.entityType} className="compare-tray-group">
            <div className="compare-tray-group-header">
              <span className="compare-tray-group-label">{typeLabel(group.entityType)}</span>
              <span className="compare-tray-group-count">{group.count}</span>
            </div>

            <div className="compare-tray-chip-row">
              {items
                .filter((item) => group.itemIds.includes(item.id))
                .map((item) => (
                <button
                  key={`${item.entityType}:${item.id}`}
                  className="compare-tray-chip"
                  data-tooltip={t("shell.compareTray.removeTooltip", { name: item.label })}
                  onClick={() => removeItem(item.entityType, item.id)}
                  type="button"
                >
                  <span>{item.label}</span>
                  <X size={12} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="compare-tray-footnote">
        {reasonDisabled ?? t("shell.compareTray.footnoteFallback")}
      </p>
    </aside>
  );
};
