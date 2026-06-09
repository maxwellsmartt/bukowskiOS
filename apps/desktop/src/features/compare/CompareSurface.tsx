import { ArrowLeft, Scale, Trash2, X } from "lucide-react";
import { useMemo } from "react";

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

const typeLabelMap: Record<CompareEntityType, string> = {
  asset: "Assets",
  project: "Projects",
  financial_entry: "Finance entries",
};

const normalizeCompareValue = (value: string) => value.trim().toLowerCase();

const buildAssetFields = (asset: AssetListRow): CompareField[] => [
  { label: "Code", value: asset.code, emphasized: true },
  { label: "Category", value: asset.category },
  { label: "Status", value: asset.status },
  { label: "Condition", value: asset.condition },
  { label: "Custody", value: asset.custody },
  { label: "Location", value: asset.location },
  { label: "Project", value: asset.project || "Unassigned" },
  { label: "Unit", value: asset.projectUnit || "-" },
  { label: "Responsible", value: asset.responsible || "-" },
  { label: "Serial", value: asset.serialNumber || "-" },
  { label: "QR", value: asset.qrCode || "-" },
  { label: "Warehouse", value: asset.warehouseSlot || "-" },
  { label: "Open issues", value: String(asset.incidentsOpen) },
];

const buildProjectFields = (project: ProjectCardRow): CompareField[] => [
  { label: "Code", value: project.code, emphasized: true },
  { label: "Client", value: project.client },
  { label: "Status", value: project.status },
  { label: "Start", value: project.startDate ?? "Open" },
  { label: "End", value: project.endDate ?? "Open" },
  { label: "Units", value: String(project.activeUnitCount) },
  { label: "Assets", value: String(project.assetCount) },
  { label: "Incidents", value: String(project.incidentCount) },
  { label: "Exposure", value: project.exposure },
  { label: "Departments", value: project.departments },
];

const buildFinanceFields = (entry: FinanceEntryRow): CompareField[] => [
  { label: "Reference", value: entry.reference, emphasized: true },
  { label: "Date", value: entry.date },
  { label: "Type", value: entry.type },
  { label: "Category", value: entry.category },
  { label: "Project", value: entry.project },
  { label: "Amount", value: entry.amount },
  { label: "Status", value: entry.status },
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
          return asset ? { item, fields: buildAssetFields(asset) } : null;
        })
        .filter(Boolean) as CompareCard[];
    }

    if (activeType === "project") {
      const byId = new Map(projects.map((project) => [project.id, project]));
      return comparableItems
        .map((item) => {
          const project = byId.get(item.id);
          return project ? { item, fields: buildProjectFields(project) } : null;
        })
        .filter(Boolean) as CompareCard[];
    }

    const byId = new Map(financeEntries.map((entry) => [entry.id, entry]));
    return comparableItems
      .map((item) => {
        const entry = byId.get(item.id);
        return entry ? { item, fields: buildFinanceFields(entry) } : null;
      })
      .filter(Boolean) as CompareCard[];
  }, [activeType, assets, comparableItems, financeEntries, projects]);

  const diffSet = useMemo(() => buildFieldDiffSet(cards), [cards]);

  if (!activeType || comparableItems.length < 2) {
    if (variant === "dialog") {
      return (
        <div className="compare-dialog-empty">
          <div>
            <h2>Nothing is ready to compare yet</h2>
            <p>Add at least two assets, projects or finance entries of the same type to compare them side by side.</p>
          </div>
          {onClose ? (
            <button className="ghost-control" onClick={onClose} type="button">
              Close
            </button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="page-stack">
        <SectionHeader title="Compare" body="Review comparable items side by side once the tray has at least two items of the same type." />
        <GuidedEmptyState
          title="Nothing is ready to compare yet"
          body="Add at least two assets, projects or finance entries of the same type to the compare tray. Mixed trays are fine, but compare opens the first compatible group."
          tips={[
            "Select rows in Assets, Projects or Finance Entries",
            "Use Add to compare from the selection bar",
            "Then open Compare from the tray",
          ]}
          actionLabel="Go back"
          onAction={onBack}
        />
      </div>
    );
  }

  const title = `${typeLabelMap[activeType]} side by side`;
  const body = "Use this view to spot operational differences quickly before making decisions or opening a deeper workflow.";
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
            <span className="compare-dialog-eyebrow">Compare</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
          {onClose ? (
            <button aria-label="Close comparison" className="icon-ghost-control" onClick={onClose} type="button">
              <X size={18} />
            </button>
          ) : null}
        </header>
      ) : (
        <SectionHeader eyebrow="Compare" title={title} body={body} />
      )}

      <div className="compare-toolbar">
        <div className="compare-overview-row">
          <StatusBadge tone="success">
            <Scale size={12} />
            <span>{cards.length} items ready</span>
          </StatusBadge>
          {hiddenItems > 0 ? (
            <StatusBadge tone="warning">{`${hiddenItems} other tray item${hiddenItems === 1 ? "" : "s"} not shown here`}</StatusBadge>
          ) : null}
        </div>

        <div className="compare-page-actions">
          {onBack ? (
            <button className="ghost-control" onClick={onBack} type="button">
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
          ) : null}
          <button className="ghost-control is-danger" onClick={clearComparison} type="button">
            <Trash2 size={14} />
            <span>Clear tray</span>
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
                aria-label={`Remove ${card.item.label} from compare`}
                className="surface-card-action is-danger"
                data-tooltip={`Remove ${card.item.label}`}
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
