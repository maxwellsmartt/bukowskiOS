import { Scale, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCompareTray } from "@app/providers/CompareTrayContext";
import { CompareDialog } from "@features/compare/CompareSurface";

type CompareEntityType = "asset" | "project" | "financial_entry";

export const CompareTrayBar = () => {
  const { t } = useTranslation();
  const { clear, compatibleItems, compatibleType, groups, items, reasonDisabled, removeItem } = useCompareTray();
  const [open, setOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (compatibleItems.length < 2) {
      setOpen(false);
      setCompareOpen(false);
    }
  }, [compatibleItems.length]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (shellRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (compatibleItems.length < 2) {
    return null;
  }

  const typeLabel = (type: CompareEntityType) => t(`shell.compareTray.types.${type}`);
  const clearCompareSelection = () => {
    setOpen(false);
    setCompareOpen(false);
    clear();
    window.dispatchEvent(new CustomEvent("bukowski:compare-tray-clear-selection"));
  };

  return (
    <div className="compare-tray-shell" ref={shellRef}>
      <div className="compare-tray-launcher-wrap">
        <button
          aria-expanded={open}
          className={`compare-tray-launcher${open ? " is-open" : ""}`}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <Scale size={14} />
          <span>{t("shell.compareTray.title")}</span>
          <strong>{compatibleItems.length}</strong>
        </button>
        <button
          aria-label={t("shell.compareTray.clearAria")}
          className="compare-tray-clear-badge"
          onClick={clearCompareSelection}
          type="button"
        >
          <X size={12} />
        </button>
      </div>

      {open ? (
        <aside className="compare-tray" role="dialog" aria-label={t("shell.compareTray.title")}>
          <div className="compare-tray-header">
            <div>
              <h3 className="compare-tray-title">{t("shell.compareTray.title")}</h3>
              <p className="compare-tray-subtitle">{reasonDisabled ?? t("shell.compareTray.footnoteFallback")}</p>
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

                  setOpen(false);
                  setCompareOpen(true);
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
                onClick={clearCompareSelection}
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
        </aside>
      ) : null}
      {compareOpen ? <CompareDialog onClose={() => setCompareOpen(false)} /> : null}
    </div>
  );
};
