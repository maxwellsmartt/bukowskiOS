import { Scale, Trash2, X } from "lucide-react";

import { useCompareTray } from "@app/providers/CompareTrayContext";

const typeLabelMap = {
  asset: "Assets",
  project: "Projects",
  financial_entry: "Finance",
} as const;

export const CompareTrayBar = () => {
  const { clear, compatibleItems, compatibleType, groups, items, reasonDisabled, removeItem } = useCompareTray();

  if (!items.length) {
    return null;
  }

  return (
    <aside className="compare-tray">
      <div className="compare-tray-header">
        <div>
          <h3 className="compare-tray-title">Compare tray</h3>
          <p className="compare-tray-subtitle">Keep comparable items together while you review the workspace.</p>
        </div>

        <div className="compare-tray-actions">
          <button
            className="ghost-control"
            disabled={!compatibleType || compatibleItems.length < 2}
            title={reasonDisabled ?? "Comparison view is not available yet."}
            type="button"
          >
            <Scale size={14} />
            <span>
              {compatibleType && compatibleItems.length >= 2
                ? `Compare ${typeLabelMap[compatibleType]} (${compatibleItems.length})`
                : "Compare unavailable"}
            </span>
          </button>
          <button className="ghost-control" onClick={clear} type="button">
            <Trash2 size={14} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      <div className="compare-tray-groups">
        {groups.map((group) => (
          <div key={group.entityType} className="compare-tray-group">
            <div className="compare-tray-group-header">
              <span className="compare-tray-group-label">{typeLabelMap[group.entityType]}</span>
              <span className="compare-tray-group-count">{group.count}</span>
            </div>

            <div className="compare-tray-chip-row">
              {items
                .filter((item) => group.itemIds.includes(item.id))
                .map((item) => (
                <button
                  key={`${item.entityType}:${item.id}`}
                  className="compare-tray-chip"
                  onClick={() => removeItem(item.entityType, item.id)}
                  title={`Remove ${item.label}`}
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
        {reasonDisabled ?? "The tray can hold mixed types. Compare activates only for same-type groups."}
      </p>
    </aside>
  );
};
