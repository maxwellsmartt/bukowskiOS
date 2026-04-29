import type { ChangeEvent, ReactNode } from "react";
import { ChevronDown, Download, FileText, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";
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

const singularLabelMap: Record<CatalogEntityType, string> = {
  location: "location",
  department: "department",
  crew: "crew member",
  client: "client",
  production_company: "production company",
  manufacturer: "manufacturer",
  category: "category",
  kit: "kit",
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

const resolveCatalogPreviewTitle = (entityType: CatalogEntityType, row: Record<string, unknown>) => {
  switch (entityType) {
    case "crew":
      return (row.fullName as string) || "Crew member";
    case "client":
      return (row.name as string) || "Client";
    case "production_company":
      return (row.name as string) || "Production company";
    case "manufacturer":
      return (row.name as string) || "Manufacturer";
    case "kit":
      return (row.name as string) || "Kit";
    case "location":
    case "department":
    case "category":
    default:
      return (row.name as string) || (row.code as string) || "Catalog record";
  }
};

const buildCatalogPreviewRows = (entityType: CatalogEntityType, row: Record<string, unknown>) => {
  switch (entityType) {
    case "location":
      return [
        { label: "Code", value: String(row.code ?? "—") },
        { label: "Type", value: String(row.type ?? "—") },
        { label: "Status", value: (row.isActive as boolean) ? "Active" : "Inactive" },
        { label: "Description", value: String(row.description ?? "—") },
      ];
    case "department":
      return [
        { label: "Code", value: String(row.code ?? "—") },
        { label: "Status", value: (row.isActive as boolean) ? "Active" : "Inactive" },
        { label: "Description", value: String(row.description ?? "—") },
      ];
    case "crew":
      return [
        { label: "Department", value: String(row.primaryDepartment ?? "—") },
        { label: "Document ID", value: String(row.documentId ?? "—") },
        { label: "Role", value: String(row.roleLabel ?? "—") },
        { label: "Email", value: String(row.email ?? "—") },
        { label: "Phone", value: String(row.phone ?? "—") },
      ];
    case "client":
      return [
        { label: "Contact", value: String(row.contactName ?? "—") },
        { label: "Email", value: String(row.email ?? "—") },
        { label: "Phone", value: String(row.phone ?? "—") },
      ];
    case "production_company":
      return [
        { label: "Contact", value: String(row.contactName ?? "—") },
        { label: "Email", value: String(row.email ?? "—") },
        { label: "Phone", value: String(row.phone ?? "—") },
      ];
    case "manufacturer":
      return [
        { label: "Contact", value: String(row.contactName ?? "—") },
        { label: "Support email", value: String(row.supportEmail ?? "—") },
        { label: "Phone", value: String(row.phone ?? "—") },
      ];
    case "kit":
      return [
        { label: "Code", value: String(row.code ?? "—") },
        { label: "Members", value: String(Array.isArray(row.assetSelections) ? row.assetSelections.length : 0) },
        { label: "Units in package", value: String(row.assetCount ?? "0") },
        { label: "Primary QR", value: String(row.primaryCodeValue ?? "Pending") },
        { label: "Description", value: String(row.description ?? "—") },
      ];
    case "category":
    default:
      return [
        { label: "Code", value: String(row.code ?? "—") },
        { label: "Status", value: (row.isActive as boolean) ? "Active" : "Inactive" },
        { label: "Description", value: String(row.description ?? "—") },
      ];
  }
};

const catalogSortOptionsByEntityType: Record<CatalogEntityType, Array<ListSortOption<CatalogSortField>>> = {
  location: [
    { value: "name", label: "Name", columnKey: "name" },
    { value: "code", label: "Code", columnKey: "code" },
    { value: "type", label: "Type", columnKey: "type" },
    { value: "status", label: "Status", columnKey: "status" },
    { value: "description", label: "Description", columnKey: "description" },
  ],
  department: [
    { value: "name", label: "Name", columnKey: "name" },
    { value: "code", label: "Code", columnKey: "code" },
    { value: "status", label: "Status", columnKey: "status" },
    { value: "description", label: "Description", columnKey: "description" },
  ],
  crew: [
    { value: "fullName", label: "Crew name", columnKey: "fullName" },
    { value: "roleLabel", label: "Role", columnKey: "roleLabel" },
    { value: "email", label: "Email", columnKey: "email" },
    { value: "phone", label: "Phone", columnKey: "phone" },
    { value: "status", label: "Status" },
  ],
  client: [
    { value: "name", label: "Client", columnKey: "name" },
    { value: "contactName", label: "Contact", columnKey: "contactName" },
    { value: "email", label: "Email", columnKey: "email" },
    { value: "phone", label: "Phone", columnKey: "phone" },
    { value: "status", label: "Status" },
  ],
  production_company: [
    { value: "name", label: "Production company", columnKey: "name" },
    { value: "contactName", label: "Contact", columnKey: "contactName" },
    { value: "email", label: "Email", columnKey: "email" },
    { value: "phone", label: "Phone", columnKey: "phone" },
    { value: "status", label: "Status" },
  ],
  manufacturer: [
    { value: "name", label: "Manufacturer", columnKey: "name" },
    { value: "contactName", label: "Contact", columnKey: "contactName" },
    { value: "supportEmail", label: "Support email", columnKey: "supportEmail" },
    { value: "phone", label: "Phone", columnKey: "phone" },
    { value: "status", label: "Status" },
  ],
  kit: [
    { value: "name", label: "Kit", columnKey: "name" },
    { value: "code", label: "Code", columnKey: "code" },
    { value: "assetCount", label: "Item count", columnKey: "assetCount" },
    { value: "description", label: "Description", columnKey: "description" },
    { value: "status", label: "Status" },
  ],
  category: [
    { value: "name", label: "Category", columnKey: "name" },
    { value: "code", label: "Code", columnKey: "code" },
    { value: "status", label: "Status", columnKey: "status" },
    { value: "description", label: "Description", columnKey: "description" },
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
  const preview = state.preview;

  return (
    <div aria-modal="true" className="confirm-dialog-backdrop" role="dialog">
      <div className="confirm-dialog catalog-import-dialog">
        <div className="confirm-dialog-header">
          <span className="confirm-dialog-icon">
            <Upload size={16} />
          </span>
          <div className="confirm-dialog-copy">
            <strong>Import {entityLabel} CSV</strong>
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
              <strong>Merge</strong>
              <span>Add new rows and update matches.</span>
            </button>
            <button
              className={`catalog-import-strategy-button${state.strategy === "replace" ? " active" : ""}`}
              disabled={isSubmitting}
              onClick={() => onStrategyChange("replace")}
              type="button"
            >
              <strong>Replace</strong>
              <span>Deactivate rows missing from the file.</span>
            </button>
          </div>

          {state.error ? <div className="empty-state">{state.error}</div> : null}

          {preview ? (
            <div className="compact-summary-grid">
              <div className="summary-row">
                <span className="summary-label">Rows</span>
                <span className="summary-value">{preview.totalRows}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Create</span>
                <span className="summary-value">{preview.created}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Update</span>
                <span className="summary-value">{preview.updated}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Deactivate</span>
                <span className={`summary-value${preview.deactivated ? " metric-tone-warning" : ""}`}>{preview.deactivated}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Invalid</span>
                <span className={`summary-value${preview.invalid ? " metric-tone-critical" : ""}`}>{preview.invalid}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Skipped</span>
                <span className="summary-value">{preview.skipped}</span>
              </div>
            </div>
          ) : null}

          {preview?.invalid ? (
            <div className="action-feedback action-feedback-warning">
              Fix the invalid rows below, then choose the CSV again.
            </div>
          ) : null}

          {preview?.errors.length ? (
            <div className="catalog-import-errors">
              {preview.errors.slice(0, 6).map((error) => (
                <div key={`${error.rowNumber}-${error.message}`} className="catalog-import-error-row">
                  <strong>Row {error.rowNumber}</strong>
                  <span>{error.message}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="confirm-dialog-actions">
          <button className="ghost-control cancel-control" disabled={isSubmitting} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="action-primary-button"
            disabled={isSubmitting || !preview || preview.invalid > 0}
            onClick={onConfirm}
            type="button"
          >
            {isSubmitting ? "Importing..." : `Import ${entityLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export const CatalogPage = () => {
  const { refreshProjects } = useShellContext();
  const { activeWorkspaceId } = useWorkspace();
  const { data: projects } = useProjectsData();
  const [activeTab, setActiveTab] = useState<CatalogEntityType>("crew");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const catalogControls = useListControls<CatalogSortField, CatalogListQuery>({
    viewKey: `catalog-${activeTab}-list`,
    defaults: {
      search: "",
      sortBy: activeTab === "crew" ? "fullName" : "name",
      sortDirection: "asc",
    },
    sortOptions: catalogSortOptionsByEntityType[activeTab],
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
  const sectionScopeLabel = useSectionScopeLabel();
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

    const nextUsersSnapshot = await window.bukowskiApp.getUsersSnapshot();
    setUsersSnapshot(nextUsersSnapshot);
    setCreateCrewUserRoleId((current) => current || nextUsersSnapshot.roles[0]?.id || "");
  };

  useEffect(() => {
    void loadUsersSnapshot();
  }, []);

  const tabs = useMemo<CatalogTabConfig[]>(
    () => [
      {
        key: "location",
        label: "Locations",
        title: "Locations",
        rows: data.locations as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: "Code", width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: "Name", width: 180, minWidth: 140, render: (row) => row.name as string },
          { key: "type", label: "Type", width: 120, minWidth: 100, render: (row) => row.type as string },
          { key: "description", label: "Description", width: 250, minWidth: 180, render: (row) => row.description as string },
          {
            key: "status",
            label: "Status",
            width: 90,
            minWidth: 78,
            render: (row) => <StatusBadge>{(row.isActive as boolean) ? "Active" : "Inactive"}</StatusBadge>,
          },
        ],
      },
      {
        key: "department",
        label: "Departments",
        title: "Departments",
        rows: data.departments as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: "Code", width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: "Name", width: 180, minWidth: 140, render: (row) => row.name as string },
          { key: "description", label: "Description", width: 260, minWidth: 180, render: (row) => row.description as string },
          {
            key: "status",
            label: "Status",
            width: 90,
            minWidth: 78,
            render: (row) => <StatusBadge>{(row.isActive as boolean) ? "Active" : "Inactive"}</StatusBadge>,
          },
        ],
      },
      {
        key: "crew",
        label: "Crew",
        title: "Crew",
        rows: data.crewMembers as Array<Record<string, unknown>>,
        columns: [
          { key: "fullName", label: "Crew", width: 180, minWidth: 144, render: (row) => row.fullName as string },
          {
            key: "primaryDepartment",
            label: "Department",
            width: 160,
            minWidth: 130,
            render: (row) => (row.primaryDepartment as string) || "—",
          },
          { key: "roleLabel", label: "Role", width: 140, minWidth: 110, render: (row) => (row.roleLabel as string) || "—" },
          { key: "email", label: "Email", width: 180, minWidth: 150, render: (row) => (row.email as string) || "—" },
          { key: "phone", label: "Phone", width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
        ],
      },
      {
        key: "client",
        label: "Clients",
        title: "Clients",
        rows: data.clients as Array<Record<string, unknown>>,
        columns: [
          { key: "name", label: "Client", width: 180, minWidth: 144, render: (row) => row.name as string },
          { key: "contactName", label: "Contact", width: 150, minWidth: 120, render: (row) => (row.contactName as string) || "—" },
          { key: "email", label: "Email", width: 180, minWidth: 150, render: (row) => (row.email as string) || "—" },
          { key: "phone", label: "Phone", width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
        ],
      },
      {
        key: "production_company",
        label: "Production Companies",
        title: "Production Companies",
        rows: data.productionCompanies as Array<Record<string, unknown>>,
        columns: [
          { key: "name", label: "Company", width: 200, minWidth: 150, render: (row) => row.name as string },
          { key: "contactName", label: "Contact", width: 160, minWidth: 130, render: (row) => (row.contactName as string) || "—" },
          { key: "email", label: "Email", width: 180, minWidth: 150, render: (row) => (row.email as string) || "—" },
          { key: "phone", label: "Phone", width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
          {
            key: "status",
            label: "Status",
            width: 90,
            minWidth: 78,
            render: (row) => <StatusBadge>{(row.isActive as boolean) ? "Active" : "Inactive"}</StatusBadge>,
          },
        ],
      },
      {
        key: "manufacturer",
        label: "Manufacturers",
        title: "Manufacturers",
        rows: data.manufacturers as Array<Record<string, unknown>>,
        columns: [
          { key: "name", label: "Manufacturer", width: 180, minWidth: 144, render: (row) => row.name as string },
          { key: "contactName", label: "Contact", width: 150, minWidth: 120, render: (row) => (row.contactName as string) || "—" },
          { key: "supportEmail", label: "Support email", width: 200, minWidth: 160, render: (row) => (row.supportEmail as string) || "—" },
          { key: "phone", label: "Phone", width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
        ],
      },
      {
        key: "kit",
        label: "Kits",
        title: "Kits",
        rows: data.kits as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: "Code", width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: "Kit", width: 180, minWidth: 144, render: (row) => row.name as string },
          {
            key: "memberCount",
            label: "Package",
            width: 172,
            minWidth: 148,
            render: (row) =>
              `${Array.isArray(row.assetSelections) ? row.assetSelections.length : 0} members · ${String(row.assetCount ?? 0)} units`,
          },
          { key: "primaryCodeValue", label: "QR ready", width: 170, minWidth: 132, render: (row) => row.primaryCodeValue as string },
          { key: "description", label: "Description", width: 220, minWidth: 170, render: (row) => row.description as string },
        ],
      },
      {
        key: "category",
        label: "Categories",
        title: "Categories",
        rows: data.categories as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: "Code", width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: "Category", width: 180, minWidth: 144, render: (row) => row.name as string },
          { key: "description", label: "Description", width: 260, minWidth: 180, render: (row) => row.description as string },
          {
            key: "status",
            label: "Status",
            width: 90,
            minWidth: 78,
            render: (row) => <StatusBadge>{(row.isActive as boolean) ? "Active" : "Inactive"}</StatusBadge>,
          },
        ],
      },
    ],
    [data],
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
      setEditorError(getUserFacingErrorMessage(nextError, "Could not save this catalog record."));
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
      setCatalogActionMessage(getUserFacingErrorMessage(nextError, "Could not export this CSV."));
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
        error: getUserFacingErrorMessage(nextError, "Could not preview this CSV."),
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
      setEditorError(getUserFacingErrorMessage(nextError, "Crew document upload failed."));
    } finally {
      setIsUploadingCrewDocuments(false);
    }
  };

  const handleDeleteCrewDocument = async (fileId: string) => {
    try {
      const result = await deleteCrewCatalogDocument(fileId);
      setCatalogActionMessage(result.summary);
      await reload();
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, "Crew document removal failed."));
    }
  };

  const handleCreateInternalUserFromCrew = async () => {
    if (!window.bukowskiApp || !previewCrewRow) {
      return;
    }

    if (!createCrewUserRoleId) {
      setEditorError("Pick a role before creating the user.");
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
      setEditorError(getUserFacingErrorMessage(nextError, "Could not create the user from this crew record."));
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
              error: getUserFacingErrorMessage(nextError, "Could not import this CSV."),
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
          ? `Assigned from kit ${activeKitRow.code} · ${activeKitRow.name}. ${value.notes}`
          : `Assigned from kit ${activeKitRow.code} · ${activeKitRow.name}.`,
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), refreshProjects()]);
      setKitAssignError(null);
      setKitAssignOpen(false);
      setCatalogActionMessage(result.summary);
    } catch (nextError) {
      setKitAssignError(getUserFacingErrorMessage(nextError, "Kit assignment failed."));
    } finally {
      setIsSubmittingKitAssign(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        title="Catalog"
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Catalog unavailable: {error}</div> : null}
      {!error && isLoading ? (
        <SurfaceCard title="Catalog">
          <TableSkeleton body="Loading locations, crew, clients and categories." columns={4} />
        </SurfaceCard>
      ) : null}

      {!error && !isLoading && totalCatalogRecords === 0 ? (
        <GuidedEmptyState
          title="Start with your shared records"
          body="Add locations, departments, crew, clients and categories here so the rest of the app stays consistent."
          tips={[
            "Create locations before moving inventory",
            "Add departments and crew before assigning work",
            "Define categories before creating assets",
          ]}
          actionLabel="Create first location"
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
          className="catalog-surface-card"
          title={activeTabConfig.title}
          aside={
            <div className="surface-card-actions catalog-toolbar-actions">
              <button
                className="catalog-toolbar-button"
                onClick={() => importInputRef.current?.click()}
                type="button"
              >
                <Download size={14} />
                <span>Import CSV</span>
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
                <span>{selectedCount ? `Export selected (${selectedCount})` : "Export CSV"}</span>
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
                <span>Edit</span>
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
                <span>Delete</span>
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
                <span>New</span>
              </button>
            </div>
          }
        >
          <input accept=".csv,text/csv" className="sr-only" onChange={handleImportFileSelected} ref={importInputRef} type="file" />
          {catalogActionMessage ? (
            <div className="selection-action-bar">
              <div className="selection-action-copy">
                <span className="selection-action-title">Catalog update</span>
                <span className="selection-action-subtitle">{catalogActionMessage}</span>
              </div>
              <div className="selection-action-buttons">
                <button className="icon-ghost-control" data-tooltip="Clear message" onClick={() => setCatalogActionMessage(null)} type="button">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : null}
          {selectedCount ? (
            <div className="selection-action-bar">
              <div className="selection-action-copy">
                <span className="selection-action-title">
                  {selectedCount === 1 ? `1 ${singularLabelMap[activeTab]} selected` : `${selectedCount} ${activeTabConfig.label.toLowerCase()} selected`}
                </span>
                <span className="selection-action-subtitle">
                  {selectedCount === 1 ? "Edit, export or delete this record." : "Delete works in batch. Edit stays for one row."}
                </span>
              </div>
              <div className="selection-action-buttons">
                <button
                  className="icon-ghost-control"
                  data-tooltip="Clear selection"
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
            searchPlaceholder={`Search ${activeTabConfig.label.toLowerCase()}`}
            searchValue={catalogControls.searchValue}
            sortBy={catalogControls.sortBy}
            sortDirection={catalogControls.sortDirection}
            sortOptions={catalogSortOptionsByEntityType[activeTab]}
          />
          <DataTable
            activeRowId={activePreviewIds[activeTab]}
            columns={activeTabConfig.columns}
            emptyMessage={`No ${activeTabConfig.label.toLowerCase()} yet. Create the first one here.`}
            getRowId={(row) => String(row.id)}
            maxHeight="min(68vh, 760px)"
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
            title={resolveCatalogPreviewTitle(activeTab, previewRow)}
            aside={
              <button
                aria-label="Close catalog preview"
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
                <span className="summary-label">Type</span>
                <span className="summary-value">{activeTabConfig.label}</span>
              </div>
              {buildCatalogPreviewRows(activeTab, previewRow).map((row) => (
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
                  <h3 className="surface-card-title">App user</h3>
                    </div>
                  </div>

                  {previewLinkedUser ? (
                    <div className="summary-grid">
                      <div className="summary-row">
                        <span className="summary-label">Linked user</span>
                        <span className="summary-value">{previewLinkedUser.fullName}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Role</span>
                        <span className="summary-value">{previewLinkedUser.roleName ?? "No role assigned"}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Telegram</span>
                        <span className="summary-value">
                          {previewLinkedUser.telegramLinkStatus === "linked"
                            ? "Linked"
                            : previewLinkedUser.telegramLinkStatus === "pending"
                              ? "Pending link"
                              : previewLinkedUser.telegramLinkStatus === "revoked"
                                ? "Revoked"
                                : "Not linked"}
                        </span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Ready</span>
                        <span className="summary-value">{previewLinkedUser.readyForTelegram ? "Ready to link" : "Needs setup"}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="agent-form-grid">
                        <label className="field-block">
                          <span className="field-label">Role</span>
                          <select
                            className="field-input"
                            onChange={(event) => setCreateCrewUserRoleId(event.target.value)}
                            value={createCrewUserRoleId}
                          >
                            <option value="">Select a role</option>
                            {usersSnapshot.roles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="field-block field-block-span-2">
                          <span className="field-label">What will be reused</span>
                          <div className="summary-grid">
                            <div className="summary-row">
                              <span className="summary-label">Name</span>
                              <span className="summary-value">{previewCrewRow?.fullName ?? "—"}</span>
                            </div>
                            <div className="summary-row">
                              <span className="summary-label">Email</span>
                              <span className="summary-value">{previewCrewRow?.email || "No email yet"}</span>
                            </div>
                            <div className="summary-row">
                              <span className="summary-label">Phone</span>
                              <span className="summary-value">{previewCrewRow?.phone || "No phone yet"}</span>
                            </div>
                            <div className="summary-row">
                              <span className="summary-label">Membership</span>
                              <span className="summary-value">Active on create</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="models-provider-diagnostic">
                        <span className="agent-detail-kicker">Role preview</span>
                        <p>
                          {previewCreateRole
                            ? `${previewCreateRole.name}: ${previewCreateRole.permissionKeys.join(", ")}`
                            : "Pick a role first. You can refine permissions later in Users & access."}
                        </p>
                      </div>

                      <div className="action-panel-actions action-panel-actions-start">
                        <button
                          className="action-primary-button"
                          disabled={!createCrewUserRoleId || isCreatingCrewUser}
                          onClick={() => void handleCreateInternalUserFromCrew()}
                          type="button"
                        >
                          {isCreatingCrewUser ? "Creating..." : "Create user"}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {Array.isArray(previewRow.bankAccounts) && previewRow.bankAccounts.length ? (
                  <div className="catalog-preview-section">
                    <div className="surface-card-header">
                      <div>
                        <h3 className="surface-card-title">Bank accounts</h3>
                      </div>
                    </div>
                    <div className="catalog-preview-bank-accounts">
                      {(previewRow.bankAccounts as CatalogSnapshot["crewMembers"][number]["bankAccounts"]).map((account) => (
                        <div key={account.id} className="catalog-preview-bank-account">
                          <strong>{account.bankName || account.accountType || "Bank account"}</strong>
                          <span>{account.accountHolder || "No account holder"}</span>
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
                        <h3 className="surface-card-title">Documents</h3>
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
                                  data-tooltip="Remove file"
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
                      <h3 className="surface-card-title">Package contents</h3>
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
                              <span className="identity-meta">{asset ? `${asset.code} · ${asset.category}` : "Catalog asset"}</span>
                              <span className="identity-meta">
                                {asset
                                  ? `${asset.quantity} available · ${asset.assignedQuantity} reserved · ${asset.checkedOutQuantity} out`
                                  : "Availability unavailable"}
                              </span>
                              {asset?.operationalStatus === "maintenance" ? (
                                <span className="identity-meta">In maintenance.</span>
                              ) : null}
                            </div>
                            <span className="section-header-context-pill">Qty {selection.quantity}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="catalog-crew-support-empty">No kit members linked yet.</div>
                  )}
                </div>

                {activeKitBlockedMembers.length ? (
                  <div className="action-feedback action-feedback-warning">
                    {activeKitMaintenanceMembers.length ? (
                      <span>
                        This kit is blocked because these members are in maintenance:{" "}
                        {activeKitMaintenanceMembers.map((row) => row.code).join(", ")}.
                        {" "}Return them to ready state before using the full kit.
                      </span>
                    ) : null}
                    {activeKitMaintenanceMembers.length && activeKitStockMembers.length ? <span> </span> : null}
                    {activeKitStockMembers.length ? (
                      <span>
                        Missing stock for {activeKitStockMembers.map((row) => `${row.code} (${row.available}/${row.requested})`).join(", ")}.
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
                    Assign kit
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
            title={`Assign kit · ${activeKitRow.code}`}
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
                <span className="list-toolbar-menu-label">Export</span>
                <button className="list-toolbar-menu-item" onClick={() => void runExport("template")} role="menuitem" type="button">
                  <span className="list-toolbar-menu-item-copy">
                    <Upload size={14} />
                    <span>Blank template</span>
                  </span>
                </button>
                <button className="list-toolbar-menu-item" onClick={() => void runExport("data")} role="menuitem" type="button">
                  <span className="list-toolbar-menu-item-copy">
                    <Upload size={14} />
                    <span>{selectedCount ? `Selected rows (${selectedCount})` : "All rows"}</span>
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
              ? `Delete this ${singularLabelMap[activeTab]} from Catalog? Existing operations that still depend on it may block the action.`
              : `Delete ${selectedCount} ${activeTabConfig.label.toLowerCase()} from Catalog? Existing operations that still depend on any of them may block the action.`
            : ""
        }
        confirmLabel="Delete"
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
        title={`Delete ${singularLabelMap[activeTab]}`}
        tone="danger"
      />
    </div>
  );
};
