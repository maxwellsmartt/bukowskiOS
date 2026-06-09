import { ArrowLeft, Scale, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { AssetListRow, CompareEntityType, CompareItem, FinanceEntryRow, ProjectCardRow } from "@contracts";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ModalShell } from "@shared/components/ModalShell";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useAssetsList } from "@features/assets/useAssetsData";
import { useFinanceEntries } from "@features/finance/useFinanceData";
import { useProjectsRegistry } from "@features/projects/useProjectsData";

type CompareField = {
  label: string;
  value: string;
  emphasized?: boolean;
};

type CompareCard = {
  item: CompareItem;
  fields: CompareField[];
};

type CompareSurfaceProps = {
  requestedType?: CompareEntityType | null;
  onBack?: () => void;
  onClose?: () => void;
  variant?: "page" | "dialog";
};

const normalizeCompareValue = (value: string) => value.trim().toLowerCase();

const buildAssetFields = (asset: AssetListRow, t: TFunction): CompareField[] => [
  { label: t("compare.fields.code"), value: asset.code, emphasized: true },
  { label: t("compare.fields.category"), value: asset.category },
  { label: t("compare.fields.status"), value: asset.status },
  { label: t("compare.fields.condition"), value: asset.condition },
  { label: t("compare.fields.custody"), value: asset.custody },
  { label: t("compare.fields.location"), value: asset.location },
  { label: t("compare.fields.project"), value: asset.project || t("compare.fallbacks.unassigned") },
  { label: t("compare.fields.unit"), value: asset.projectUnit || "-" },
  { label: t("compare.fields.responsible"), value: asset.responsible || "-" },
  { label: t("compare.fields.serial"), value: asset.serialNumber || "-" },
  { label: t("compare.fields.qr"), value: asset.qrCode || "-" },
  { label: t("compare.fields.warehouse"), value: asset.warehouseSlot || "-" },
  { label: t("compare.fields.openIssues"), value: String(asset.incidentsOpen) },
];

const buildProjectFields = (project: ProjectCardRow, t: TFunction): CompareField[] => [
  { label: t("compare.fields.code"), value: project.code, emphasized: true },
  { label: t("compare.fields.client"), value: project.client },
  { label: t("compare.fields.status"), value: project.status },
  { label: t("compare.fields.start"), value: project.startDate ?? t("compare.fallbacks.open") },
  { label: t("compare.fields.end"), value: project.endDate ?? t("compare.fallbacks.open") },
  { label: t("compare.fields.units"), value: String(project.activeUnitCount) },
  { label: t("compare.fields.assets"), value: String(project.assetCount) },
  { label: t("compare.fields.incidents"), value: String(project.incidentCount) },
  { label: t("compare.fields.exposure"), value: project.exposure },
  { label: t("compare.fields.departments"), value: project.departments },
];

const buildFinanceFields = (entry: FinanceEntryRow, t: TFunction): CompareField[] => [
  { label: t("compare.fields.reference"), value: entry.reference, emphasized: true },
  { label: t("compare.fields.date"), value: entry.date },
  { label: t("compare.fields.type"), value: entry.type },
  { label: t("compare.fields.category"), value: entry.category },
  { label: t("compare.fields.project"), value: entry.project },
  { label: t("compare.fields.amount"), value: entry.amount },
  { label: t("compare.fields.status"), value: entry.status },
];

const buildFieldDiffSet = (cards: CompareCard[]) => {
  const valuesByLabel = new Map<string, Set<string>>();

  cards.forEach((card) => {
    card.fields.forEach((field) => {
      const current = valuesByLabel.get(field.label) ?? new Set<string>();
      current.add(normalizeCompareValue(field.value));
      valuesByLabel.set(field.label, current);
    });
  });

  return valuesByLabel;
};

export const CompareSurface = ({ requestedType = null, onBack, onClose, variant = "page" }: CompareSurfaceProps) => {
  const { t } = useTranslation();
  const { clear, compatibleItems, compatibleType, items, removeItem } = useCompareTray();
  const { data: assets } = useAssetsList();
  const { data: projects } = useProjectsRegistry();
  const { data: financeEntries } = useFinanceEntries();

  const activeType = requestedType && compatibleType === requestedType ? requestedType : compatibleType;
  const comparableItems = useMemo(
    () => (activeType ? compatibleItems.filter((item) => item.entityType === activeType) : []),
    [activeType, compatibleItems],
  );

  const cards = useMemo<CompareCard[]>(() => {
    if (!activeType) {
      return [];
    }

    if (activeType === "asset") {
      const byId = new Map(assets.map((asset) => [asset.id, asset]));
      return comparableItems
        .map((item) => {
          const asset = byId.get(item.id);
          return asset ? { item, fields: buildAssetFields(asset, t) } : null;
        })
        .filter(Boolean) as CompareCard[];
    }

    if (activeType === "project") {
      const byId = new Map(projects.map((project) => [project.id, project]));
      return comparableItems
        .map((item) => {
          const project = byId.get(item.id);
          return project ? { item, fields: buildProjectFields(project, t) } : null;
        })
        .filter(Boolean) as CompareCard[];
    }

    const byId = new Map(financeEntries.map((entry) => [entry.id, entry]));
    return comparableItems
      .map((item) => {
        const entry = byId.get(item.id);
        return entry ? { item, fields: buildFinanceFields(entry, t) } : null;
      })
      .filter(Boolean) as CompareCard[];
  }, [activeType, assets, comparableItems, financeEntries, projects, t]);

  const diffSet = useMemo(() => buildFieldDiffSet(cards), [cards]);

  if (!activeType || comparableItems.length < 2) {
    if (variant === "dialog") {
      return (
        <div className="compare-dialog-empty">
          <div>
            <h2>{t("compare.empty.title")}</h2>
            <p>{t("compare.empty.body")}</p>
          </div>
          {onClose ? (
            <button className="ghost-control" onClick={onClose} type="button">
              {t("common.close")}
            </button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="page-stack">
        <SectionHeader title={t("compare.title")} body={t("compare.body")} />
        <GuidedEmptyState
          title={t("compare.empty.title")}
          body={t("compare.empty.body")}
          tips={[
            t("compare.empty.tipSelect"),
            t("compare.empty.tipAdd"),
            t("compare.empty.tipOpen"),
          ]}
          actionLabel={t("compare.back")}
          onAction={onBack}
        />
      </div>
    );
  }

  const title = t("compare.title");
  const body = t("compare.body");
  const hiddenItems = items.length - cards.length;
  const clearComparison = () => {
    clear();
    window.dispatchEvent(new CustomEvent("bukowski:compare-tray-clear-selection"));
    onClose?.();
  };

  return (
    <div className={variant === "dialog" ? "compare-dialog-content" : "page-stack"}>
      {variant === "dialog" ? (
        <header className="compare-dialog-header">
          <div>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
          {onClose ? (
            <button aria-label={t("compare.close")} className="icon-ghost-control compare-remove-button" data-tooltip={t("compare.close")} onClick={onClose} type="button">
              <X size={18} />
            </button>
          ) : null}
        </header>
      ) : (
        <SectionHeader title={title} body={body} />
      )}

      <div className="compare-toolbar">
        <div className="compare-overview-row">
          <StatusBadge tone="success">
            <Scale size={12} />
            <span>{t("compare.itemsReady", { count: cards.length })}</span>
          </StatusBadge>
          {hiddenItems > 0 ? (
            <StatusBadge tone="warning">{t("compare.hiddenItems", { count: hiddenItems })}</StatusBadge>
          ) : null}
        </div>

        <div className="compare-page-actions">
          {onBack ? (
            <button className="ghost-control" onClick={onBack} type="button">
              <ArrowLeft size={14} />
              <span>{t("compare.back")}</span>
            </button>
          ) : null}
          <button className="ghost-control is-danger" onClick={clearComparison} type="button">
            <Trash2 size={14} />
            <span>{t("compare.clearTray")}</span>
          </button>
        </div>
      </div>

      <div className={`compare-grid compare-grid-${activeType}`}>
        {cards.map((card) => (
          <SurfaceCard
            key={`${card.item.entityType}:${card.item.id}`}
            className="compare-card"
            title={card.item.label}
            subtitle={card.item.subtitle}
            aside={
              <button
                aria-label={t("compare.removeItemAria", { item: card.item.label })}
                className="surface-card-action compare-remove-button is-danger"
                data-tooltip={t("compare.removeItemTooltip", { item: card.item.label })}
                onClick={() => removeItem(card.item.entityType, card.item.id)}
                type="button"
              >
                <Trash2 size={14} />
              </button>
            }
          >
            <div className="compare-meta-row">
              {card.item.meta ? <StatusBadge>{card.item.meta}</StatusBadge> : null}
              {card.item.colorKey ? <StatusBadge tone="info">{card.item.colorKey}</StatusBadge> : null}
            </div>

            <div className="compare-field-list">
              {card.fields.map((field) => {
                const isDifferent = (diffSet.get(field.label)?.size ?? 0) > 1;

                return (
                  <div
                    key={field.label}
                    className={`compare-field-row${isDifferent ? " is-different" : ""}${field.emphasized ? " is-emphasized" : ""}`}
                  >
                    <span className="compare-field-label">{field.label}</span>
                    <span className="compare-field-value">{field.value}</span>
                  </div>
                );
              })}
            </div>
          </SurfaceCard>
        ))}
      </div>
    </div>
  );
};

export const CompareDialog = ({ onClose }: { onClose: () => void }) => (
  <ModalShell backdropClassName="compare-dialog-backdrop" className="compare-dialog-shell" onClose={onClose} width={1320}>
    <CompareSurface onClose={onClose} variant="dialog" />
  </ModalShell>
);
