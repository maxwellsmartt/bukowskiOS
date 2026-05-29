import type { ChangeEvent, ReactNode } from "react";
import { ChevronDown, Download, FileText, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type {
  AppUsersSnapshot,
  CatalogCsvImportPreview,
  CatalogCsvImportStrategy,
  CatalogEntityType,
  CatalogListQuery,
  CatalogSnapshot,
  CatalogSortField,
} from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { AssetAssignMovePanel, type AssetAssignSelectionRow, type AssetAssignMoveFormValue } from "@features/assets/AssetAssignMovePanel";
import { assignMoveAssets } from "@features/assets/useAssetsData";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListToolbar } from "@shared/components/ListToolbar";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useConfirmDialog } from "@shared/hooks/useConfirmDialog";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { uiPreferenceKeys } from "@shared/lib/preferences";

import { CatalogEditorPanel } from "./CatalogEditorPanel";
import {
  createCatalogEntity,
  deleteCatalogEntities,
  deleteCatalogEntity,
  deleteCrewCatalogDocument,
  exportCatalogCsv,
  importCatalogCsv,
  notifyCatalogChanged,
  openCrewCatalogDocument,
  previewCatalogCsvImport,
  uploadCrewCatalogDocuments,
  updateCatalogEntity,
  useCatalogData,
  useProjectsData,
} from "./useProjectsData";

const emptyUsersSnapshot: AppUsersSnapshot = {
  users: [],
  roles: [],
};

type CatalogTabConfig = {
  key: CatalogEntityType;
  label: string;
  title: string;
  rows: Array<Record<string, unknown>>;
  columns: Array<{
    key: string;
    label: string;
    width?: number;
    minWidth?: number;
    align?: "left" | "right";
    render: (row: Record<string, unknown>) => ReactNode;
  }>;
};

const catalogTabOrder: CatalogEntityType[] = [
  "crew",
  "department",
  "kit",
  "location",
  "category",
  "client",
  "production_company",
  "manufacturer",
];

const emptySelectedState: Record<CatalogEntityType, string[]> = {
  location: [],
  department: [],
  crew: [],
  client: [],
  production_company: [],
  manufacturer: [],
  category: [],
  kit: [],
};

const singularLabelKeyMap: Record<CatalogEntityType, string> = {
  location: "catalog.entities.location.singular",
  department: "catalog.entities.department.singular",
  crew: "catalog.entities.crew.singular",
  client: "catalog.entities.client.singular",
  production_company: "catalog.entities.production_company.singular",
  manufacturer: "catalog.entities.manufacturer.singular",
  category: "catalog.entities.category.singular",
  kit: "catalog.entities.kit.singular",
};

const formatBytes = (value: number) => {
  if (!value) {
    return "0 B";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${value} B`;
};

const resolveCatalogPreviewTitle = (entityType: CatalogEntityType, row: Record<string, unknown>, t: TFunction) => {
  switch (entityType) {
    case "crew":
      return (row.fullName as string) || t("catalog.entities.crew.singular");
    case "client":
      return (row.name as string) || t("catalog.entities.client.singular");
    case "production_company":
      return (row.name as string) || t("catalog.entities.production_company.singular");
    case "manufacturer":
      return (row.name as string) || t("catalog.entities.manufacturer.singular");
    case "kit":
      return (row.name as string) || t("catalog.entities.kit.singular");
    case "location":
    case "department":
    case "category":
    default:
      return (row.name as string) || (row.code as string) || t("catalog.fallbacks.record");
  }
};

const buildCatalogPreviewRows = (entityType: CatalogEntityType, row: Record<string, unknown>, t: TFunction) => {
  const status = (row.isActive as boolean) ? t("catalog.status.active") : t("catalog.status.inactive");

  switch (entityType) {
    case "location":
      return [
        { label: t("catalog.fields.code"), value: String(row.code ?? "—") },
        { label: t("catalog.fields.type"), value: String(row.type ?? "—") },
        { label: t("catalog.fields.status"), value: status },
        { label: t("catalog.fields.description"), value: String(row.description ?? "—") },
      ];
    case "department":
      return [
        { label: t("catalog.fields.code"), value: String(row.code ?? "—") },
        { label: t("catalog.fields.status"), value: status },
        { label: t("catalog.fields.description"), value: String(row.description ?? "—") },
      ];
    case "crew":
      return [
        { label: t("catalog.fields.department"), value: String(row.primaryDepartment ?? "—") },
        { label: t("catalog.fields.documentId"), value: String(row.documentId ?? "—") },
        { label: t("catalog.fields.role"), value: String(row.roleLabel ?? "—") },
        { label: t("catalog.fields.email"), value: String(row.email ?? "—") },
        { label: t("catalog.fields.phone"), value: String(row.phone ?? "—") },
      ];
    case "client":
      return [
        { label: t("catalog.fields.contact"), value: String(row.contactName ?? "—") },
        { label: t("catalog.fields.email"), value: String(row.email ?? "—") },
        { label: t("catalog.fields.phone"), value: String(row.phone ?? "—") },
      ];
    case "production_company":
      return [
        { label: t("catalog.fields.contact"), value: String(row.contactName ?? "—") },
        { label: t("catalog.fields.email"), value: String(row.email ?? "—") },
        { label: t("catalog.fields.phone"), value: String(row.phone ?? "—") },
      ];
    case "manufacturer":
      return [
        { label: t("catalog.fields.contact"), value: String(row.contactName ?? "—") },
        { label: t("catalog.fields.supportEmail"), value: String(row.supportEmail ?? "—") },
        { label: t("catalog.fields.phone"), value: String(row.phone ?? "—") },
      ];
    case "kit":
      return [
        { label: t("catalog.fields.code"), value: String(row.code ?? "—") },
        { label: t("catalog.fields.members"), value: String(Array.isArray(row.assetSelections) ? row.assetSelections.length : 0) },
        { label: t("catalog.fields.unitsInPackage"), value: String(row.assetCount ?? "0") },
        { label: t("catalog.fields.primaryQr"), value: String(row.primaryCodeValue ?? t("catalog.status.pending")) },
        { label: t("catalog.fields.description"), value: String(row.description ?? "—") },
      ];
    case "category":
    default:
      return [
        { label: t("catalog.fields.code"), value: String(row.code ?? "—") },
        { label: t("catalog.fields.status"), value: status },
        { label: t("catalog.fields.description"), value: String(row.description ?? "—") },
      ];
  }
};

const catalogSortOptionsByEntityType: Record<CatalogEntityType, Array<ListSortOption<CatalogSortField> & { labelKey: string }>> = {
  location: [
    { value: "name", label: "Name", labelKey: "catalog.fields.name", columnKey: "name" },
    { value: "code", label: "Code", labelKey: "catalog.fields.code", columnKey: "code" },
    { value: "type", label: "Type", labelKey: "catalog.fields.type", columnKey: "type" },
    { value: "status", label: "Status", labelKey: "catalog.fields.status", columnKey: "status" },
    { value: "description", label: "Description", labelKey: "catalog.fields.description", columnKey: "description" },
  ],
  department: [
    { value: "name", label: "Name", labelKey: "catalog.fields.name", columnKey: "name" },
    { value: "code", label: "Code", labelKey: "catalog.fields.code", columnKey: "code" },
    { value: "status", label: "Status", labelKey: "catalog.fields.status", columnKey: "status" },
    { value: "description", label: "Description", labelKey: "catalog.fields.description", columnKey: "description" },
  ],
  crew: [
    { value: "fullName", label: "Crew name", labelKey: "catalog.fields.crewName", columnKey: "fullName" },
    { value: "roleLabel", label: "Role", labelKey: "catalog.fields.role", columnKey: "roleLabel" },
    { value: "email", label: "Email", labelKey: "catalog.fields.email", columnKey: "email" },
    { value: "phone", label: "Phone", labelKey: "catalog.fields.phone", columnKey: "phone" },
    { value: "status", label: "Status", labelKey: "catalog.fields.status" },
  ],
  client: [
    { value: "name", label: "Client", labelKey: "catalog.entities.client.singular", columnKey: "name" },
    { value: "contactName", label: "Contact", labelKey: "catalog.fields.contact", columnKey: "contactName" },
    { value: "email", label: "Email", labelKey: "catalog.fields.email", columnKey: "email" },
    { value: "phone", label: "Phone", labelKey: "catalog.fields.phone", columnKey: "phone" },
    { value: "status", label: "Status", labelKey: "catalog.fields.status" },
  ],
  production_company: [
    { value: "name", label: "Production company", labelKey: "catalog.entities.production_company.singular", columnKey: "name" },
    { value: "contactName", label: "Contact", labelKey: "catalog.fields.contact", columnKey: "contactName" },
    { value: "email", label: "Email", labelKey: "catalog.fields.email", columnKey: "email" },
    { value: "phone", label: "Phone", labelKey: "catalog.fields.phone", columnKey: "phone" },
    { value: "status", label: "Status", labelKey: "catalog.fields.status" },
  ],
  manufacturer: [
    { value: "name", label: "Manufacturer", labelKey: "catalog.entities.manufacturer.singular", columnKey: "name" },
    { value: "contactName", label: "Contact", labelKey: "catalog.fields.contact", columnKey: "contactName" },
    { value: "supportEmail", label: "Support email", labelKey: "catalog.fields.supportEmail", columnKey: "supportEmail" },
    { value: "phone", label: "Phone", labelKey: "catalog.fields.phone", columnKey: "phone" },
    { value: "status", label: "Status", labelKey: "catalog.fields.status" },
  ],
  kit: [
    { value: "name", label: "Kit", labelKey: "catalog.entities.kit.singular", columnKey: "name" },
    { value: "code", label: "Code", labelKey: "catalog.fields.code", columnKey: "code" },
    { value: "assetCount", label: "Item count", labelKey: "catalog.fields.itemCount", columnKey: "assetCount" },
    { value: "description", label: "Description", labelKey: "catalog.fields.description", columnKey: "description" },
    { value: "status", label: "Status", labelKey: "catalog.fields.status" },
  ],
  category: [
    { value: "name", label: "Category", labelKey: "catalog.entities.category.singular", columnKey: "name" },
    { value: "code", label: "Code", labelKey: "catalog.fields.code", columnKey: "code" },
    { value: "status", label: "Status", labelKey: "catalog.fields.status", columnKey: "status" },
    { value: "description", label: "Description", labelKey: "catalog.fields.description", columnKey: "description" },
  ],
};

type ImportDialogState = {
  fileName: string;
  csvText: string;
  strategy: CatalogCsvImportStrategy;
  preview: CatalogCsvImportPreview | null;
  error: string | null;
};

type CatalogCsvImportDialogProps = {
  entityLabel: string;
  state: ImportDialogState;
  isSubmitting: boolean;
  onClose: () => void;
  onStrategyChange: (strategy: CatalogCsvImportStrategy) => void;
  onConfirm: () => void;
};

const CatalogCsvImportDialog = ({
  entityLabel,
  state,
  isSubmitting,
  onClose,
  onStrategyChange,
  onConfirm,
}: CatalogCsvImportDialogProps) => {
  const { t } = useTranslation();
  const preview = state.preview;

  return (
    <div aria-modal="true" className="confirm-dialog-backdrop" role="dialog">
      <div className="confirm-dialog catalog-import-dialog">
        <div className="confirm-dialog-header">
          <span className="confirm-dialog-icon">
            <Upload size={16} />
          </span>
          <div className="confirm-dialog-copy">
            <strong>{t("catalog.import.title", { entity: entityLabel })}</strong>
            <p>{state.fileName}</p>
          </div>
        </div>

        <div className="catalog-import-body">
          <div className="catalog-import-strategy">
            <button
              className={`catalog-import-strategy-button${state.strategy === "merge" ? " active" : ""}`}
              disabled={isSubmitting}
              onClick={() => onStrategyChange("merge")}
              type="button"
            >
              <strong>{t("catalog.import.merge")}</strong>
              <span>{t("catalog.import.mergeHelp")}</span>
            </button>
            <button
              className={`catalog-import-strategy-button${state.strategy === "replace" ? " active" : ""}`}
              disabled={isSubmitting}
              onClick={() => onStrategyChange("replace")}
              type="button"
            >
              <strong>{t("catalog.import.replace")}</strong>
              <span>{t("catalog.import.replaceHelp")}</span>
            </button>
          </div>

          {state.error ? <div className="empty-state">{state.error}</div> : null}

          {preview ? (
            <div className="compact-summary-grid">
              <div className="summary-row">
                <span className="summary-label">{t("catalog.import.rows")}</span>
                <span className="summary-value">{preview.totalRows}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("catalog.import.create")}</span>
                <span className="summary-value">{preview.created}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("catalog.import.update")}</span>
                <span className="summary-value">{preview.updated}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("catalog.import.deactivate")}</span>
                <span className={`summary-value${preview.deactivated ? " metric-tone-warning" : ""}`}>{preview.deactivated}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("catalog.import.invalid")}</span>
                <span className={`summary-value${preview.invalid ? " metric-tone-critical" : ""}`}>{preview.invalid}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("catalog.import.skipped")}</span>
                <span className="summary-value">{preview.skipped}</span>
              </div>
            </div>
          ) : null}

          {preview?.invalid ? (
            <div className="action-feedback action-feedback-warning">
              {t("catalog.import.fixInvalidRows")}
            </div>
          ) : null}

          {preview?.errors.length ? (
            <div className="catalog-import-errors">
              {preview.errors.slice(0, 6).map((error) => (
                <div key={`${error.rowNumber}-${error.message}`} className="catalog-import-error-row">
                  <strong>{t("catalog.import.row", { row: error.rowNumber })}</strong>
                  <span>{error.message}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="confirm-dialog-actions">
          <button className="ghost-control cancel-control" disabled={isSubmitting} onClick={onClose} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="action-primary-button"
            disabled={isSubmitting || !preview || preview.invalid > 0}
            onClick={onConfirm}
            type="button"
          >
            {isSubmitting ? t("catalog.import.importing") : t("catalog.import.importEntity", { entity: entityLabel })}
          </button>
        </div>
      </div>
    </div>
  );
};

export const CatalogPage = () => {
  const { t } = useTranslation();
  const { confirm: confirmDelete, confirmDialog: deleteConfirmDialog } = useConfirmDialog();
  const { refreshProjects } = useShellContext();
  const { activeWorkspaceId } = useWorkspace();
  const { data: projects } = useProjectsData();
  const [activeTab, setActiveTab] = useState<CatalogEntityType>("crew");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeSortOptions = useMemo(
    () => catalogSortOptionsByEntityType[activeTab].map((option) => ({ ...option, label: t(option.labelKey) })),
    [activeTab, t],
  );
  const catalogControls = useListControls<CatalogSortField, CatalogListQuery>({
    viewKey: `catalog-${activeTab}-list`,
    defaults: {
      search: "",
      sortBy: activeTab === "crew" ? "fullName" : "name",
      sortDirection: "asc",
    },
    sortOptions: activeSortOptions,
    defaultDirectionBySort: {
      assetCount: "desc",
    },
    buildQuery: ({ search, sortBy, sortDirection }) => ({
      workspaceId: activeWorkspaceId,
      entityType: activeTab,
      search,
      sortBy,
      sortDirection,
    }),
  });
  const { data, error, isLoading, reload } = useCatalogData(catalogControls.query);
  const [selectedIds, setSelectedIds] = useState<Record<CatalogEntityType, string[]>>(emptySelectedState);
  const [activePreviewIds, setActivePreviewIds] = useState<Record<CatalogEntityType, string | null>>({
    location: null,
    department: null,
    crew: null,
    client: null,
    production_company: null,
    manufacturer: null,
    category: null,
    kit: null,
  });
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSubmittingEditor, setIsSubmittingEditor] = useState(false);
  const [isUploadingCrewDocuments, setIsUploadingCrewDocuments] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportMenuStyle, setExportMenuStyle] = useState<{ top: number; left: number; placement: "bottom" | "top" } | null>(null);
  const [importDialogState, setImportDialogState] = useState<ImportDialogState | null>(null);
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const [catalogActionMessage, setCatalogActionMessage] = useState<string | null>(null);
  const [kitAssignOpen, setKitAssignOpen] = useState(false);
  const [kitAssignError, setKitAssignError] = useState<string | null>(null);
  const [isSubmittingKitAssign, setIsSubmittingKitAssign] = useState(false);
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const [isCreatingCrewUser, setIsCreatingCrewUser] = useState(false);
  const [createCrewUserRoleId, setCreateCrewUserRoleId] = useState("");

  const loadUsersSnapshot = async () => {
    if (!window.bukowskiApp) {
      return;
    }

    const nextUsersSnapshot = await window.bukowskiApp.getUsersSnapshot({ workspaceId: activeWorkspaceId });
    setUsersSnapshot(nextUsersSnapshot);
    setCreateCrewUserRoleId((current) => current || nextUsersSnapshot.roles[0]?.id || "");
  };

  useEffect(() => {
    void loadUsersSnapshot();
  }, [activeWorkspaceId]);

  const tabs = useMemo<CatalogTabConfig[]>(
    () => [
      {
        key: "location",
        label: t("catalog.entities.location.plural"),
        title: t("catalog.entities.location.plural"),
        rows: data.locations as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: t("catalog.fields.code"), width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: t("catalog.fields.name"), width: 180, minWidth: 140, render: (row) => row.name as string },
          { key: "type", label: t("catalog.fields.type"), width: 120, minWidth: 100, render: (row) => row.type as string },
          { key: "description", label: t("catalog.fields.description"), width: 250, minWidth: 180, render: (row) => row.description as string },
          {
            key: "status",
            label: t("catalog.fields.status"),
            width: 90,
            minWidth: 78,
            render: (row) => <StatusBadge>{(row.isActive as boolean) ? t("catalog.status.active") : t("catalog.status.inactive")}</StatusBadge>,
          },
        ],
      },
      {
        key: "department",
        label: t("catalog.entities.department.plural"),
        title: t("catalog.entities.department.plural"),
        rows: data.departments as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: t("catalog.fields.code"), width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: t("catalog.fields.name"), width: 180, minWidth: 140, render: (row) => row.name as string },
          { key: "description", label: t("catalog.fields.description"), width: 260, minWidth: 180, render: (row) => row.description as string },
          {
            key: "status",
            label: t("catalog.fields.status"),
            width: 90,
            minWidth: 78,
            render: (row) => <StatusBadge>{(row.isActive as boolean) ? t("catalog.status.active") : t("catalog.status.inactive")}</StatusBadge>,
          },
        ],
      },
      {
        key: "crew",
        label: t("catalog.entities.crew.plural"),
        title: t("catalog.entities.crew.plural"),
        rows: data.crewMembers as Array<Record<string, unknown>>,
        columns: [
          { key: "fullName", label: t("catalog.entities.crew.plural"), width: 180, minWidth: 144, render: (row) => row.fullName as string },
          {
            key: "primaryDepartment",
            label: t("catalog.fields.department"),
            width: 160,
            minWidth: 130,
            render: (row) => (row.primaryDepartment as string) || "—",
          },
          { key: "roleLabel", label: t("catalog.fields.role"), width: 140, minWidth: 110, render: (row) => (row.roleLabel as string) || "—" },
          { key: "email", label: t("catalog.fields.email"), width: 180, minWidth: 150, render: (row) => (row.email as string) || "—" },
          { key: "phone", label: t("catalog.fields.phone"), width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
        ],
      },
      {
        key: "client",
        label: t("catalog.entities.client.plural"),
        title: t("catalog.entities.client.plural"),
        rows: data.clients as Array<Record<string, unknown>>,
        columns: [
          { key: "name", label: t("catalog.entities.client.singular"), width: 180, minWidth: 144, render: (row) => row.name as string },
          { key: "contactName", label: t("catalog.fields.contact"), width: 150, minWidth: 120, render: (row) => (row.contactName as string) || "—" },
          { key: "email", label: t("catalog.fields.email"), width: 180, minWidth: 150, render: (row) => (row.email as string) || "—" },
          { key: "phone", label: t("catalog.fields.phone"), width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
        ],
      },
      {
        key: "production_company",
        label: t("catalog.entities.production_company.plural"),
        title: t("catalog.entities.production_company.plural"),
        rows: data.productionCompanies as Array<Record<string, unknown>>,
        columns: [
          { key: "name", label: t("catalog.fields.company"), width: 200, minWidth: 150, render: (row) => row.name as string },
          { key: "contactName", label: t("catalog.fields.contact"), width: 160, minWidth: 130, render: (row) => (row.contactName as string) || "—" },
          { key: "email", label: t("catalog.fields.email"), width: 180, minWidth: 150, render: (row) => (row.email as string) || "—" },
          { key: "phone", label: t("catalog.fields.phone"), width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
          {
            key: "status",
            label: t("catalog.fields.status"),
            width: 90,
            minWidth: 78,
            render: (row) => <StatusBadge>{(row.isActive as boolean) ? t("catalog.status.active") : t("catalog.status.inactive")}</StatusBadge>,
          },
        ],
      },
      {
        key: "manufacturer",
        label: t("catalog.entities.manufacturer.plural"),
        title: t("catalog.entities.manufacturer.plural"),
        rows: data.manufacturers as Array<Record<string, unknown>>,
        columns: [
          { key: "name", label: t("catalog.entities.manufacturer.singular"), width: 180, minWidth: 144, render: (row) => row.name as string },
          { key: "contactName", label: t("catalog.fields.contact"), width: 150, minWidth: 120, render: (row) => (row.contactName as string) || "—" },
          { key: "supportEmail", label: t("catalog.fields.supportEmail"), width: 200, minWidth: 160, render: (row) => (row.supportEmail as string) || "—" },
          { key: "phone", label: t("catalog.fields.phone"), width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
        ],
      },
      {
        key: "kit",
        label: t("catalog.entities.kit.plural"),
        title: t("catalog.entities.kit.plural"),
        rows: data.kits as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: t("catalog.fields.code"), width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: t("catalog.entities.kit.singular"), width: 180, minWidth: 144, render: (row) => row.name as string },
          {
            key: "memberCount",
            label: t("catalog.fields.package"),
            width: 172,
            minWidth: 148,
            render: (row) =>
              t("catalog.kit.memberSummary", {
                members: Array.isArray(row.assetSelections) ? row.assetSelections.length : 0,
                units: String(row.assetCount ?? 0),
              }),
          },
          { key: "primaryCodeValue", label: t("catalog.fields.qrReady"), width: 170, minWidth: 132, render: (row) => row.primaryCodeValue as string },
          { key: "description", label: t("catalog.fields.description"), width: 220, minWidth: 170, render: (row) => row.description as string },
        ],
      },
      {
        key: "category",
        label: t("catalog.entities.category.plural"),
        title: t("catalog.entities.category.plural"),
        rows: data.categories as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: t("catalog.fields.code"), width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: t("catalog.entities.category.singular"), width: 180, minWidth: 144, render: (row) => row.name as string },
          { key: "description", label: t("catalog.fields.description"), width: 260, minWidth: 180, render: (row) => row.description as string },
          {
            key: "status",
            label: t("catalog.fields.status"),
            width: 90,
            minWidth: 78,
            render: (row) => <StatusBadge>{(row.isActive as boolean) ? t("catalog.status.active") : t("catalog.status.inactive")}</StatusBadge>,
          },
        ],
      },
    ],
    [data, t],
  );

  const activeTabConfig = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
  const selectedRowIds = selectedIds[activeTab];
  const selectedCount = selectedRowIds.length;
  const previewRow = activeTabConfig.rows.find((row) => row.id === activePreviewIds[activeTab]) ?? null;
  const assetOptionsById = useMemo(
    () => new Map(data.assetOptions.map((asset) => [asset.id, asset] as const)),
    [data.assetOptions],
  );
  const selectedRow = selectedRowIds.length === 1 ? activeTabConfig.rows.find((row) => row.id === selectedRowIds[0]) ?? null : null;
  const editTargetRow = selectedCount === 1 ? selectedRow : selectedCount === 0 ? previewRow : null;
  const showPreview = Boolean(previewRow) && !editorMode;
  const showContextColumn = Boolean(editorMode) || showPreview;
  const activeKitRow =
    activeTab === "kit" && editTargetRow ? (editTargetRow as CatalogSnapshot["kits"][number]) : null;
  const previewCrewRow =
    activeTab === "crew" && previewRow ? (previewRow as CatalogSnapshot["crewMembers"][number]) : null;
  const previewLinkedUser = useMemo(
    () =>
      previewCrewRow?.linkedUserId
        ? usersSnapshot.users.find((user) => user.id === previewCrewRow.linkedUserId) ?? null
        : null,
    [previewCrewRow?.linkedUserId, usersSnapshot.users],
  );
  const previewCreateRole = useMemo(
    () => usersSnapshot.roles.find((role) => role.id === createCrewUserRoleId) ?? null,
    [createCrewUserRoleId, usersSnapshot.roles],
  );
  const activeKitSelections = activeKitRow?.assetSelections ?? [];
  const activeKitAssignmentAssets = useMemo<AssetAssignSelectionRow[]>(
    () =>
      activeKitSelections
        .map<AssetAssignSelectionRow | null>((selection) => {
          const asset = assetOptionsById.get(selection.assetId);
          if (!asset) {
            return null;
          }

          return {
            id: asset.id,
            name: asset.name,
            code: asset.code,
            quantity: asset.quantity,
            assignedQuantity: asset.assignedQuantity,
            checkedOutQuantity: asset.checkedOutQuantity,
            status: asset.status,
            project: asset.currentProject ?? undefined,
            linkedKitCount: asset.linkedKitCount,
            linkedKitCodes: asset.linkedKitCodes,
          } satisfies AssetAssignSelectionRow;
        })
        .filter((asset): asset is AssetAssignSelectionRow => Boolean(asset)),
    [activeKitSelections, assetOptionsById],
  );
  const activeKitBlockedMembers = useMemo(
    () =>
      activeKitSelections
        .map((selection) => {
          const asset = assetOptionsById.get(selection.assetId);
          if (!asset) {
            return {
              code: selection.assetId,
              requested: selection.quantity,
              available: 0,
              reason: "missing" as const,
            };
          }

          if (asset.operationalStatus === "maintenance") {
            return {
              code: asset.code,
              requested: selection.quantity,
              available: asset.quantity,
              reason: "maintenance" as const,
            };
          }

          if (asset.quantity < selection.quantity) {
            return {
              code: asset.code,
              requested: selection.quantity,
              available: asset.quantity,
              reason: "stock" as const,
            };
          }

          return null;
        })
        .filter(
          (
            row,
          ): row is { code: string; requested: number; available: number; reason: "missing" | "maintenance" | "stock" } =>
            Boolean(row),
        ),
    [activeKitSelections, assetOptionsById],
  );
  const activeKitMaintenanceMembers = useMemo(
    () => activeKitBlockedMembers.filter((row) => row.reason === "maintenance"),
    [activeKitBlockedMembers],
  );
  const activeKitStockMembers = useMemo(
    () => activeKitBlockedMembers.filter((row) => row.reason === "stock" || row.reason === "missing"),
    [activeKitBlockedMembers],
  );
  const canAssignActiveKit = Boolean(activeKitRow) && activeKitSelections.length > 0 && activeKitBlockedMembers.length === 0;
  const totalCatalogRecords = useMemo(
    () =>
      data.locations.length +
      data.departments.length +
      data.crewMembers.length +
      data.clients.length +
      data.productionCompanies.length +
      data.manufacturers.length +
      data.kits.length +
      data.categories.length,
    [data],
  );

  useEffect(() => {
    if (!exportMenuOpen) {
      return;
    }

    const updateMenuPosition = () => {
      const trigger = exportTriggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const menuWidth = 220;
      const estimatedMenuHeight = 132;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const fitsBelow = rect.bottom + 8 + estimatedMenuHeight <= viewportHeight - 12;
      const placement = fitsBelow ? "bottom" : "top";
      const top = placement === "bottom" ? rect.bottom + 8 : Math.max(12, rect.top - estimatedMenuHeight - 8);
      const left = Math.max(12, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 12));

      setExportMenuStyle({ top, left, placement });
    };

    updateMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!exportMenuRef.current?.contains(target) && !exportTriggerRef.current?.contains(target)) {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [exportMenuOpen]);

  const applyCatalogMutation = async (
    callback: () => Promise<CatalogSnapshot>,
    nextSelectedId: string[] = selectedIds[activeTab],
  ) => {
    try {
      setIsSubmittingEditor(true);
      await callback();
      await reload();
      setSelectedIds((current) => ({ ...current, [activeTab]: nextSelectedId }));
      setActivePreviewIds((current) => ({
        ...current,
        [activeTab]: nextSelectedId.length === 1 ? nextSelectedId[0] : current[activeTab],
      }));
      setEditorMode(null);
      setEditorError(null);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("catalog.errors.save")));
    } finally {
      setIsSubmittingEditor(false);
    }
  };

  const runExport = async (mode: "template" | "data") => {
    try {
      const result = await exportCatalogCsv({
        workspaceId: activeWorkspaceId,
        entityType: activeTab,
        mode,
        ids: mode === "data" && selectedCount ? selectedRowIds : undefined,
      });
      setCatalogActionMessage(result.summary);
    } catch (nextError) {
      setCatalogActionMessage(getUserFacingErrorMessage(nextError, t("catalog.errors.exportCsv")));
    } finally {
      setExportMenuOpen(false);
    }
  };

  const refreshImportPreview = async (strategy: CatalogCsvImportStrategy, csvText: string, fileName: string) => {
    try {
      const preview = await previewCatalogCsvImport({ workspaceId: activeWorkspaceId, entityType: activeTab, csvText, strategy });
      setImportDialogState({
        fileName,
        csvText,
        strategy,
        preview,
        error: null,
      });
    } catch (nextError) {
      setImportDialogState({
        fileName,
        csvText,
        strategy,
        preview: null,
        error: getUserFacingErrorMessage(nextError, t("catalog.errors.previewCsv")),
      });
    }
  };

  const handleUploadCrewDocuments = async (crewMemberId: string, sourceFilePaths?: string[]) => {
    try {
      setIsUploadingCrewDocuments(true);
      const result = await uploadCrewCatalogDocuments(activeWorkspaceId, crewMemberId, sourceFilePaths);
      setCatalogActionMessage(result.summary);
      await reload();
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("catalog.errors.uploadDocument")));
    } finally {
      setIsUploadingCrewDocuments(false);
    }
  };

  const handleDeleteCrewDocument = async (fileId: string) => {
    const confirmed = await confirmDelete({
      title: t("catalog.confirmRemoveDocument.title", { defaultValue: "¿Eliminar este documento?" }),
      body: t("catalog.confirmRemoveDocument.body", {
        defaultValue: "El documento se eliminará permanentemente.",
      }),
      confirmLabel: t("common.delete", { defaultValue: "Eliminar" }),
    });
    if (!confirmed) return;
    try {
      const result = await deleteCrewCatalogDocument(fileId);
      setCatalogActionMessage(result.summary);
      await reload();
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("catalog.errors.removeDocument")));
    }
  };

  const handleCreateInternalUserFromCrew = async () => {
    if (!window.bukowskiApp || !previewCrewRow) {
      return;
    }

    if (!createCrewUserRoleId) {
      setEditorError(t("catalog.errors.pickRole"));
      return;
    }

    try {
      setIsCreatingCrewUser(true);
      const result = await window.bukowskiApp.createUser({
        workspaceId: activeWorkspaceId,
        fullName: previewCrewRow.fullName,
        email: previewCrewRow.email ?? "",
        phone: previewCrewRow.phone ?? "",
        roleId: createCrewUserRoleId,
        linkedCrewMemberId: previewCrewRow.id,
      });

      setCatalogActionMessage(result.summary);
      setEditorError(null);
      await Promise.all([reload(), loadUsersSnapshot()]);
      notifyCatalogChanged();
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("catalog.errors.createUser")));
    } finally {
      setIsCreatingCrewUser(false);
    }
  };

  const handleImportFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const csvText = await file.text();
    await refreshImportPreview("merge", csvText, file.name);
  };

  const handleConfirmImport = async () => {
    if (!importDialogState) {
      return;
    }

    try {
      setIsSubmittingImport(true);
      const { result } = await importCatalogCsv({
        workspaceId: activeWorkspaceId,
        entityType: activeTab,
        csvText: importDialogState.csvText,
        strategy: importDialogState.strategy,
      });
      await reload();
      setImportDialogState(null);
      setSelectedIds((current) => ({ ...current, [activeTab]: [] }));
      setActivePreviewIds((current) => ({ ...current, [activeTab]: null }));
      setCatalogActionMessage(result.summary);
    } catch (nextError) {
      setImportDialogState((current) =>
        current
          ? {
              ...current,
              error: getUserFacingErrorMessage(nextError, t("catalog.errors.importCsv")),
            }
          : current,
      );
    } finally {
      setIsSubmittingImport(false);
    }
  };

  const handleAssignKit = async (value: AssetAssignMoveFormValue) => {
    if (!activeKitRow || !activeKitSelections.length) {
      return;
    }

    try {
      setIsSubmittingKitAssign(true);
      const result = await assignMoveAssets({
        commandId: crypto.randomUUID(),
        workspaceId: activeWorkspaceId,
        assetIds: activeKitSelections.map((selection) => selection.assetId),
        assetSelections: activeKitSelections.map((selection) => ({
          assetId: selection.assetId,
          quantity: selection.quantity,
        })),
        sourceKitId: activeKitRow.id,
        mode: "assign",
        projectId: value.projectId,
        projectUnitId: value.projectUnitId,
        departmentId: value.departmentId,
        assignedToUserId: value.assignedToUserId,
        targetLocationId: value.targetLocationId,
        expectedReturnAt: value.expectedReturnAt,
        notes: value.notes
          ? `${t("catalog.kit.assignedFrom", { code: activeKitRow.code, name: activeKitRow.name })} ${value.notes}`
          : t("catalog.kit.assignedFrom", { code: activeKitRow.code, name: activeKitRow.name }),
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), refreshProjects()]);
      setKitAssignError(null);
      setKitAssignOpen(false);
      setCatalogActionMessage(result.summary);
    } catch (nextError) {
      setKitAssignError(getUserFacingErrorMessage(nextError, t("catalog.errors.assignKit")));
    } finally {
      setIsSubmittingKitAssign(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title={t("catalog.title")} />

      {error ? <div className="empty-state">{t("catalog.unavailable", { message: error })}</div> : null}
      {!error && isLoading ? (
        <SurfaceCard title={t("catalog.title")}>
          <TableSkeleton body={t("catalog.loading")} columns={4} />
        </SurfaceCard>
      ) : null}

      {!error && !isLoading && totalCatalogRecords === 0 ? (
        <GuidedEmptyState
          title={t("catalog.empty.title")}
          body={t("catalog.empty.body")}
          tips={[t("catalog.empty.tipLocations"), t("catalog.empty.tipCrew"), t("catalog.empty.tipCategories")]}
          actionLabel={t("catalog.empty.action")}
          onAction={() => {
            setActiveTab("location");
            setEditorMode("create");
            setEditorError(null);
          }}
        />
      ) : null}

      <div className="catalog-tab-row">
        {catalogTabOrder.map((tabKey) => {
          const tab = tabs.find((entry) => entry.key === tabKey);
          if (!tab) {
            return null;
          }

          return (
            <button
              key={tab.key}
              className={`action-mode-button${activeTab === tab.key ? " active" : ""}`}
                onClick={() => {
                  setActiveTab(tab.key);
                  setEditorMode(null);
                  setEditorError(null);
                  setCatalogActionMessage(null);
                  setExportMenuOpen(false);
                  setImportDialogState(null);
                }}
              type="button"
            >
              <span>{tab.label}</span>
              <span className="catalog-tab-count">{tab.rows.length}</span>
            </button>
          );
        })}
      </div>

      <ResizableSideRailLayout
        className={showContextColumn ? "split-layout" : "list-layout"}
        defaultWidth={360}
        maxWidth={640}
        minWidth={320}
        storageKey={uiPreferenceKeys.catalogSideRailWidth}
      >
        <SurfaceCard
          className="catalog-surface-card rail-table-card"
          title={activeTabConfig.title}
          aside={
            <div className="surface-card-actions catalog-toolbar-actions">
              <button
                className="catalog-toolbar-button"
                onClick={() => importInputRef.current?.click()}
                type="button"
              >
                <Download size={14} />
                <span>{t("catalog.actions.importCsv")}</span>
              </button>
              <button
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu"
                className="catalog-toolbar-button"
                onClick={() => setExportMenuOpen((current) => !current)}
                ref={exportTriggerRef}
                type="button"
              >
                <Upload size={14} />
                <span>{selectedCount ? t("catalog.actions.exportSelected", { count: selectedCount }) : t("catalog.actions.exportCsv")}</span>
                <ChevronDown size={14} />
              </button>
              <button
                className="catalog-toolbar-button"
                disabled={!editTargetRow}
                onClick={() => {
                  setEditorMode("edit");
                  setEditorError(null);
                }}
                type="button"
              >
                <Pencil size={14} />
                <span>{t("common.edit")}</span>
              </button>
              <button
                className="catalog-toolbar-button is-danger"
                disabled={!selectedCount}
                onClick={() => {
                  setConfirmDeleteOpen(true);
                }}
                type="button"
              >
                <Trash2 size={14} />
                <span>{t("common.delete")}</span>
              </button>
              <button
                className="catalog-toolbar-button catalog-toolbar-button-primary"
                onClick={() => {
                  setEditorMode("create");
                  setEditorError(null);
                }}
                type="button"
              >
                <Plus size={14} />
                <span>{t("catalog.actions.new")}</span>
              </button>
            </div>
          }
        >
          <input accept=".csv,text/csv" className="sr-only" onChange={handleImportFileSelected} ref={importInputRef} type="file" />
          {catalogActionMessage ? (
            <div className="selection-action-bar">
              <div className="selection-action-copy">
                <span className="selection-action-title">{t("catalog.messages.update")}</span>
                <span className="selection-action-subtitle">{catalogActionMessage}</span>
              </div>
              <div className="selection-action-buttons">
                <button className="icon-ghost-control" data-tooltip={t("catalog.actions.clearMessage")} onClick={() => setCatalogActionMessage(null)} type="button">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : null}
          {selectedCount ? (
            <div className="selection-action-bar">
              <div className="selection-action-copy">
                <span className="selection-action-title">
                  {selectedCount === 1
                    ? t("catalog.selection.single", { entity: t(singularLabelKeyMap[activeTab]) })
                    : t("catalog.selection.multiple", { count: selectedCount, entity: activeTabConfig.label.toLowerCase() })}
                </span>
                <span className="selection-action-subtitle">
                  {selectedCount === 1 ? t("catalog.selection.singleHelp") : t("catalog.selection.batchHelp")}
                </span>
              </div>
              <div className="selection-action-buttons">
                <button
                  className="icon-ghost-control"
                  data-tooltip={t("catalog.actions.clearSelection")}
                  onClick={() => setSelectedIds((current) => ({ ...current, [activeTab]: [] }))}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : null}
          <ListToolbar
            activeSortLabel={catalogControls.activeSortOption?.label}
            onSearchValueChange={catalogControls.setSearchValue}
            onSortByChange={catalogControls.setSortField}
            onToggleSortDirection={catalogControls.toggleSortDirection}
            resultCount={activeTabConfig.rows.length}
            resultLabel={activeTabConfig.label.toLowerCase()}
            searchPlaceholder={t("catalog.searchPlaceholder", { entity: activeTabConfig.label.toLowerCase() })}
            searchValue={catalogControls.searchValue}
            sortBy={catalogControls.sortBy}
            sortDirection={catalogControls.sortDirection}
            sortOptions={activeSortOptions}
          />
          <DataTable
            activeRowId={activePreviewIds[activeTab]}
            columns={activeTabConfig.columns}
            emptyMessage={t("catalog.empty.table", { entity: activeTabConfig.label.toLowerCase() })}
            getRowId={(row) => String(row.id)}
            onRowClick={(row) => setActivePreviewIds((current) => ({ ...current, [activeTab]: String(row.id) }))}
            onSelectedRowIdsChange={(rowIds) =>
              setSelectedIds((current) => ({
                ...current,
                [activeTab]: rowIds,
              }))
            }
            onSortRequest={catalogControls.handleColumnSortRequest}
            persistKey={`catalog-${activeTab}`}
            rows={activeTabConfig.rows}
            shellClassName="table-shell-fill"
            selectable
            selectedRowIds={selectedRowIds}
            sortState={
              catalogControls.activeColumnKey
                ? {
                    columnKey: catalogControls.activeColumnKey,
                    direction: catalogControls.sortDirection,
                  }
                : null
            }
          />
        </SurfaceCard>

        {showContextColumn || kitAssignOpen ? (
          <div className="catalog-side-rail">
            {editorMode ? (
              <CatalogEditorPanel
            assetOptions={data.assetOptions}
            crewDocuments={activeTab === "crew" && editTargetRow ? ((editTargetRow.documents as CatalogSnapshot["crewMembers"][number]["documents"]) ?? []) : []}
            departmentOptions={data.departments}
            userOptions={data.users}
            entityType={activeTab}
            error={editorError}
            initialValue={editorMode === "edit" ? editTargetRow : null}
            isSubmitting={isSubmittingEditor}
            isUploadingCrewDocuments={isUploadingCrewDocuments}
            mode={editorMode}
            onClose={() => {
              setEditorMode(null);
              setEditorError(null);
            }}
            onDeleteCrewDocument={handleDeleteCrewDocument}
            onOpenCrewDocument={openCrewCatalogDocument}
            onSubmit={async (payload) =>
              applyCatalogMutation(
                () =>
                  editorMode === "create"
                    ? createCatalogEntity({ ...payload, workspaceId: activeWorkspaceId } as never)
                    : updateCatalogEntity({ ...payload, workspaceId: activeWorkspaceId } as never),
                editorMode === "edit" && selectedCount === 1 && typeof editTargetRow?.id === "string" ? [editTargetRow.id as string] : [],
              )
            }
            onUploadCrewDocuments={
              activeTab === "crew" && editorMode === "edit" && typeof editTargetRow?.id === "string"
                ? async () => handleUploadCrewDocuments(editTargetRow.id as string)
                : undefined
            }
            onUploadCrewDocumentsFromPaths={
              activeTab === "crew" && editorMode === "edit" && typeof editTargetRow?.id === "string"
                ? async (filePaths) => handleUploadCrewDocuments(editTargetRow.id as string, filePaths)
                : undefined
            }
              />
            ) : showPreview && previewRow ? (
              <SurfaceCard
            title={resolveCatalogPreviewTitle(activeTab, previewRow, t)}
            aside={
              <button
                aria-label={t("catalog.actions.closePreview")}
                className="surface-card-action"
                onClick={() => setActivePreviewIds((current) => ({ ...current, [activeTab]: null }))}
                type="button"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">{t("catalog.fields.type")}</span>
                <span className="summary-value">{activeTabConfig.label}</span>
              </div>
              {buildCatalogPreviewRows(activeTab, previewRow, t).map((row) => (
                <div key={row.label} className="summary-row">
                  <span className="summary-label">{row.label}</span>
                  <span className="summary-value">{row.value}</span>
                </div>
              ))}
            </div>

            {activeTab === "crew" ? (
              <>
                <div className="catalog-preview-section">
                  <div className="surface-card-header">
                    <div>
                  <h3 className="surface-card-title">{t("catalog.preview.appUser")}</h3>
                    </div>
                  </div>

                  {previewLinkedUser ? (
                    <div className="summary-grid">
                      <div className="summary-row">
                        <span className="summary-label">{t("catalog.fields.linkedUser")}</span>
                        <span className="summary-value">{previewLinkedUser.fullName}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">{t("catalog.fields.role")}</span>
                        <span className="summary-value">{previewLinkedUser.roleName ?? t("catalog.preview.noRoleAssigned")}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">{t("catalog.fields.telegram")}</span>
                        <span className="summary-value">
                          {previewLinkedUser.telegramLinkStatus === "linked"
                            ? t("catalog.telegram.linked")
                            : previewLinkedUser.telegramLinkStatus === "pending"
                              ? t("catalog.telegram.pending")
                              : previewLinkedUser.telegramLinkStatus === "revoked"
                                ? t("catalog.telegram.revoked")
                                : t("catalog.telegram.notLinked")}
                        </span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">{t("catalog.fields.ready")}</span>
                        <span className="summary-value">{previewLinkedUser.readyForTelegram ? t("catalog.telegram.ready") : t("catalog.telegram.needsSetup")}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="agent-form-grid">
                        <label className="field-block">
                          <span className="field-label">{t("catalog.fields.role")}</span>
                          <select
                            className="field-input"
                            onChange={(event) => setCreateCrewUserRoleId(event.target.value)}
                            value={createCrewUserRoleId}
                          >
                            <option value="">{t("catalog.preview.selectRole")}</option>
                            {usersSnapshot.roles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="field-block field-block-span-2">
                          <span className="field-label">{t("catalog.preview.reused")}</span>
                          <div className="summary-grid">
                            <div className="summary-row">
                              <span className="summary-label">{t("catalog.fields.name")}</span>
                              <span className="summary-value">{previewCrewRow?.fullName ?? "—"}</span>
                            </div>
                            <div className="summary-row">
                              <span className="summary-label">{t("catalog.fields.email")}</span>
                              <span className="summary-value">{previewCrewRow?.email || t("catalog.preview.noEmail")}</span>
                            </div>
                            <div className="summary-row">
                              <span className="summary-label">{t("catalog.fields.phone")}</span>
                              <span className="summary-value">{previewCrewRow?.phone || t("catalog.preview.noPhone")}</span>
                            </div>
                            <div className="summary-row">
                              <span className="summary-label">{t("catalog.fields.membership")}</span>
                              <span className="summary-value">{t("catalog.preview.activeOnCreate")}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="models-provider-diagnostic">
                        <span className="agent-detail-kicker">{t("catalog.preview.rolePreview")}</span>
                        <p>
                          {previewCreateRole
                            ? `${previewCreateRole.name}: ${previewCreateRole.permissionKeys.join(", ")}`
                            : t("catalog.preview.pickRoleFirst")}
                        </p>
                      </div>

                      <div className="action-panel-actions action-panel-actions-start">
                        <button
                          className="action-primary-button"
                          disabled={!createCrewUserRoleId || isCreatingCrewUser}
                          onClick={() => void handleCreateInternalUserFromCrew()}
                          type="button"
                        >
                          {isCreatingCrewUser ? t("catalog.preview.creatingUser") : t("catalog.preview.createUser")}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {Array.isArray(previewRow.bankAccounts) && previewRow.bankAccounts.length ? (
                  <div className="catalog-preview-section">
                    <div className="surface-card-header">
                      <div>
                        <h3 className="surface-card-title">{t("catalog.editor.bankAccounts")}</h3>
                      </div>
                    </div>
                    <div className="catalog-preview-bank-accounts">
                      {(previewRow.bankAccounts as CatalogSnapshot["crewMembers"][number]["bankAccounts"]).map((account) => (
                        <div key={account.id} className="catalog-preview-bank-account">
                          <strong>{account.bankName || account.accountType || t("catalog.preview.bankAccount")}</strong>
                          <span>{account.accountHolder || t("catalog.preview.noAccountHolder")}</span>
                          <span>{account.maskInPreview ? account.maskedAccountNumber : account.accountNumber}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(previewRow.documents) && previewRow.documents.length ? (
                  <div className="catalog-preview-section">
                    <div className="surface-card-header">
                      <div>
                        <h3 className="surface-card-title">{t("catalog.editor.documents")}</h3>
                      </div>
                    </div>
                    {(() => {
                      const documents = previewRow.documents as CatalogSnapshot["crewMembers"][number]["documents"];
                      const previewDocument = documents.find((document) => document.previewDataUrl) ?? null;

                      return (
                        <>
                          {previewDocument?.previewDataUrl ? (
                            previewDocument.mimeType === "application/pdf" ? (
                              <iframe className="catalog-preview-document-frame" src={previewDocument.previewDataUrl} title={previewDocument.originalName} />
                            ) : (
                              <img
                                alt={previewDocument.originalName}
                                className="catalog-preview-document-image"
                                src={previewDocument.previewDataUrl}
                              />
                            )
                          ) : null}
                          <div className="catalog-crew-documents-grid">
                            {documents.map((document) => (
                              <article key={document.id} className="catalog-crew-document-card">
                                <button
                                  aria-label={`Remove ${document.originalName}`}
                                  className="icon-danger-control catalog-crew-document-delete"
                                  data-tooltip={t("catalog.editor.removeFile")}
                                  onClick={() => void handleDeleteCrewDocument(document.id)}
                                  type="button"
                                >
                                  <Trash2 size={14} />
                                </button>
                                <button
                                  className="catalog-crew-document-open"
                                  onClick={() => void openCrewCatalogDocument(document.id)}
                                  type="button"
                                >
                                  <div className="catalog-crew-document-media">
                                    {document.previewDataUrl ? (
                                      document.mimeType === "application/pdf" ? (
                                        <div className="catalog-crew-document-pdf">
                                          <FileText size={24} />
                                          <span>PDF</span>
                                        </div>
                                      ) : (
                                        <img
                                          alt={document.originalName}
                                          className="catalog-crew-document-thumb"
                                          src={document.previewDataUrl}
                                        />
                                      )
                                    ) : (
                                      <div className="catalog-crew-document-pdf">
                                        <FileText size={24} />
                                        <span>{document.fileType.toUpperCase()}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="catalog-crew-document-copy">
                                    <strong>{document.originalName}</strong>
                                    <span>
                                      {document.fileType.toUpperCase()} · {formatBytes(document.byteSize)}
                                    </span>
                                  </div>
                                </button>
                              </article>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ) : null}
              </>
            ) : null}

            {activeTab === "kit" ? (
              <>
                <div className="catalog-preview-section">
                  <div className="surface-card-header">
                    <div>
                      <h3 className="surface-card-title">{t("catalog.preview.packageContents")}</h3>
                    </div>
                  </div>

                  {Array.isArray(previewRow.assetSelections) && previewRow.assetSelections.length ? (
                    <div className="catalog-kit-preview-list">
                      {(previewRow.assetSelections as CatalogSnapshot["kits"][number]["assetSelections"]).map((selection) => {
                        const asset = assetOptionsById.get(selection.assetId);

                        return (
                          <div key={selection.assetId} className="catalog-kit-preview-item">
                            <div className="identity-cell">
                              <span className="identity-title">{asset?.name ?? selection.assetId}</span>
                              <span className="identity-meta">{asset ? `${asset.code} · ${asset.category}` : t("catalog.fallbacks.asset")}</span>
                              <span className="identity-meta">
                                {asset
                                  ? t("catalog.preview.availability", {
                                      available: asset.quantity,
                                      reserved: asset.assignedQuantity,
                                      out: asset.checkedOutQuantity,
                                    })
                                  : t("catalog.preview.availabilityUnavailable")}
                              </span>
                              {asset?.operationalStatus === "maintenance" ? (
                                <span className="identity-meta">{t("catalog.preview.inMaintenance")}</span>
                              ) : null}
                            </div>
                            <span className="section-header-context-pill">{t("catalog.fields.qty")} {selection.quantity}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="catalog-crew-support-empty">{t("catalog.preview.noKitMembers")}</div>
                  )}
                </div>

                {activeKitBlockedMembers.length ? (
                  <div className="action-feedback action-feedback-warning">
                    {activeKitMaintenanceMembers.length ? (
                      <span>
                        {t("catalog.kit.blockedMaintenance")}{" "}
                        {activeKitMaintenanceMembers.map((row) => row.code).join(", ")}.
                        {" "}{t("catalog.kit.returnReady")}
                      </span>
                    ) : null}
                    {activeKitMaintenanceMembers.length && activeKitStockMembers.length ? <span> </span> : null}
                    {activeKitStockMembers.length ? (
                      <span>
                        {t("catalog.kit.missingStock", {
                          items: activeKitStockMembers.map((row) => `${row.code} (${row.available}/${row.requested})`).join(", "),
                        })}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="action-panel-actions action-panel-actions-start">
                  <button
                    className="action-primary-button"
                    disabled={!canAssignActiveKit}
                    onClick={() => {
                      setKitAssignOpen(true);
                      setKitAssignError(null);
                    }}
                    type="button"
                  >
                    {t("catalog.kit.assign")}
                  </button>
                </div>
              </>
            ) : null}
              </SurfaceCard>
            ) : null}

            {kitAssignOpen && activeKitRow ? (
              <AssetAssignMovePanel
            allowedModes={["assign"]}
            defaultProjectId={null}
            departments={data.departments}
            error={kitAssignError}
            isSubmitting={isSubmittingKitAssign}
            lockedAssetSelections={activeKitSelections}
            locations={data.locations}
            onClose={() => {
              setKitAssignOpen(false);
              setKitAssignError(null);
            }}
            onSubmit={handleAssignKit}
            projects={projects}
            selectedAssets={activeKitAssignmentAssets}
            selectedCount={activeKitAssignmentAssets.length}
            title={t("catalog.kit.assignTitle", { code: activeKitRow.code })}
            users={data.users}
              />
            ) : null}
          </div>
        ) : null}
      </ResizableSideRailLayout>

      {exportMenuOpen && exportMenuStyle
        ? createPortal(
            <div
              className={`list-toolbar-menu list-toolbar-menu-${exportMenuStyle.placement}`}
              ref={exportMenuRef}
              role="menu"
              style={{ top: exportMenuStyle.top, left: exportMenuStyle.left }}
            >
              <div className="list-toolbar-menu-section">
                <span className="list-toolbar-menu-label">{t("catalog.actions.export")}</span>
                <button className="list-toolbar-menu-item" onClick={() => void runExport("template")} role="menuitem" type="button">
                  <span className="list-toolbar-menu-item-copy">
                    <Upload size={14} />
                    <span>{t("catalog.actions.blankTemplate")}</span>
                  </span>
                </button>
                <button className="list-toolbar-menu-item" onClick={() => void runExport("data")} role="menuitem" type="button">
                  <span className="list-toolbar-menu-item-copy">
                    <Upload size={14} />
                    <span>{selectedCount ? t("catalog.actions.selectedRows", { count: selectedCount }) : t("catalog.actions.allRows")}</span>
                  </span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      {importDialogState ? (
        <CatalogCsvImportDialog
          entityLabel={activeTabConfig.label}
          isSubmitting={isSubmittingImport}
          onClose={() => {
            if (!isSubmittingImport) {
              setImportDialogState(null);
            }
          }}
          onConfirm={() => void handleConfirmImport()}
          onStrategyChange={(strategy) => {
            if (!importDialogState) {
              return;
            }
            void refreshImportPreview(strategy, importDialogState.csvText, importDialogState.fileName);
          }}
          state={importDialogState}
        />
      ) : null}

      <ConfirmDialog
        body={
          selectedCount
            ? selectedCount === 1
              ? t("catalog.deleteDialog.bodySingle", { entity: t(singularLabelKeyMap[activeTab]) })
              : t("catalog.deleteDialog.bodyMultiple", { count: selectedCount, entity: activeTabConfig.label.toLowerCase() })
            : ""
        }
        confirmLabel={t("common.delete")}
        isOpen={confirmDeleteOpen && selectedCount > 0}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          if (!selectedCount) {
            return;
          }

          const nextSelectedIds: string[] = [];
          await applyCatalogMutation(() => {
            if (selectedCount === 1 && selectedRow && typeof selectedRow.id === "string") {
              return deleteCatalogEntity({
                workspaceId: activeWorkspaceId,
                entityType: activeTab,
                id: selectedRow.id as string,
              });
            }

            return deleteCatalogEntities({
              workspaceId: activeWorkspaceId,
              entityType: activeTab,
              ids: selectedRowIds,
            });
          }, nextSelectedIds);
          setConfirmDeleteOpen(false);
        }}
        title={t("catalog.deleteDialog.title", { entity: t(singularLabelKeyMap[activeTab]) })}
        tone="danger"
      />
      {deleteConfirmDialog}
    </div>
  );
};
