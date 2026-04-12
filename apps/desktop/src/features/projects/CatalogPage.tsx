import type { ReactNode } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { CatalogEntityType, CatalogListQuery, CatalogSnapshot, CatalogSortField } from "@contracts";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

import { CatalogEditorPanel } from "./CatalogEditorPanel";
import { createCatalogEntity, deleteCatalogEntity, updateCatalogEntity, useCatalogData } from "./useProjectsData";

type CatalogTabConfig = {
  key: CatalogEntityType;
  label: string;
  title: string;
  subtitle: string;
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

const catalogTabOrder: CatalogEntityType[] = ["location", "department", "crew", "client", "manufacturer", "kit", "category"];

const emptySelectedState: Record<CatalogEntityType, string | null> = {
  location: null,
  department: null,
  crew: null,
  client: null,
  manufacturer: null,
  category: null,
  kit: null,
};

const singularLabelMap: Record<CatalogEntityType, string> = {
  location: "location",
  department: "department",
  crew: "crew member",
  client: "client",
  manufacturer: "manufacturer",
  category: "category",
  kit: "kit",
};

const resolveCatalogPreviewTitle = (entityType: CatalogEntityType, row: Record<string, unknown>) => {
  switch (entityType) {
    case "crew":
      return (row.fullName as string) || "Crew member";
    case "client":
      return (row.name as string) || "Client";
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
    case "manufacturer":
      return [
        { label: "Contact", value: String(row.contactName ?? "—") },
        { label: "Support email", value: String(row.supportEmail ?? "—") },
        { label: "Phone", value: String(row.phone ?? "—") },
      ];
    case "kit":
      return [
        { label: "Code", value: String(row.code ?? "—") },
        { label: "Assets", value: String(row.assetCount ?? "0") },
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
    { value: "assetCount", label: "Asset count", columnKey: "assetCount" },
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

export const CatalogPage = () => {
  const [activeTab, setActiveTab] = useState<CatalogEntityType>("location");
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
      entityType: activeTab,
      search,
      sortBy,
      sortDirection,
    }),
  });
  const { data, error, isLoading, reload } = useCatalogData(catalogControls.query);
  const sectionScopeLabel = useSectionScopeLabel();
  const [selectedIds, setSelectedIds] = useState<Record<CatalogEntityType, string | null>>(emptySelectedState);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSubmittingEditor, setIsSubmittingEditor] = useState(false);

  const tabs = useMemo<CatalogTabConfig[]>(
    () => [
      {
        key: "location",
        label: "Locations",
        title: "Locations",
        subtitle: "Global physical anchors for warehouse, sets, maintenance and return routing.",
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
        subtitle: "Reusable operational groups for assignments, incidents, packing and project structure.",
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
        subtitle: "Operational collaborator catalog, separate from product auth and login concerns.",
        rows: data.crewMembers as Array<Record<string, unknown>>,
        columns: [
          { key: "fullName", label: "Crew", width: 180, minWidth: 144, render: (row) => row.fullName as string },
          { key: "roleLabel", label: "Role", width: 140, minWidth: 110, render: (row) => (row.roleLabel as string) || "—" },
          { key: "email", label: "Email", width: 180, minWidth: 150, render: (row) => (row.email as string) || "—" },
          { key: "phone", label: "Phone", width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
        ],
      },
      {
        key: "client",
        label: "Clients",
        title: "Clients",
        subtitle: "Global client records reused by projects instead of loose text fields.",
        rows: data.clients as Array<Record<string, unknown>>,
        columns: [
          { key: "name", label: "Client", width: 180, minWidth: 144, render: (row) => row.name as string },
          { key: "contactName", label: "Contact", width: 150, minWidth: 120, render: (row) => (row.contactName as string) || "—" },
          { key: "email", label: "Email", width: 180, minWidth: 150, render: (row) => (row.email as string) || "—" },
          { key: "phone", label: "Phone", width: 140, minWidth: 120, render: (row) => (row.phone as string) || "—" },
        ],
      },
      {
        key: "manufacturer",
        label: "Manufacturers",
        title: "Manufacturers",
        subtitle: "Support contacts reused by RMA so escalations stay consistent and faster to prepare.",
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
        subtitle: "Asset packages that live together and prepare future project, packing and dispatch workflows.",
        rows: data.kits as Array<Record<string, unknown>>,
        columns: [
          { key: "code", label: "Code", width: 90, minWidth: 76, render: (row) => row.code as string },
          { key: "name", label: "Kit", width: 180, minWidth: 144, render: (row) => row.name as string },
          { key: "assetCount", label: "Assets", align: "right", width: 80, minWidth: 66, render: (row) => row.assetCount as number },
          { key: "primaryCodeValue", label: "QR ready", width: 170, minWidth: 132, render: (row) => row.primaryCodeValue as string },
          { key: "description", label: "Description", width: 220, minWidth: 170, render: (row) => row.description as string },
        ],
      },
      {
        key: "category",
        label: "Categories",
        title: "Categories",
        subtitle: "Registry categories stay global so new assets remain organized and searchable from day one.",
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
  const selectedRow = activeTabConfig.rows.find((row) => row.id === selectedIds[activeTab]) ?? null;
  const showPreview = Boolean(selectedRow) && !editorMode;
  const showContextColumn = Boolean(editorMode) || showPreview;
  const totalCatalogRecords = useMemo(
    () =>
      data.locations.length +
      data.departments.length +
      data.crewMembers.length +
      data.clients.length +
      data.manufacturers.length +
      data.kits.length +
      data.categories.length,
    [data],
  );

  const applyCatalogMutation = async (
    callback: () => Promise<CatalogSnapshot>,
    nextSelectedId: string | null = selectedIds[activeTab],
  ) => {
    try {
      setIsSubmittingEditor(true);
      await callback();
      await reload();
      setSelectedIds((current) => ({ ...current, [activeTab]: nextSelectedId }));
      setEditorMode(null);
      setEditorError(null);
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : "Catalog mutation failed.");
    } finally {
      setIsSubmittingEditor(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Catalog"
        title="Master data"
        body="Global records for locations, departments, crew, clients, manufacturers, kits and categories."
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Catalog unavailable: {error}</div> : null}
      {!error && isLoading ? <div className="empty-state">Loading master data...</div> : null}

      {!error && !isLoading && totalCatalogRecords === 0 ? (
        <GuidedEmptyState
          title="Start here before loading real operations"
          body="Catalog is the shared foundation for locations, departments, crew, clients and categories. Filling it first keeps assets, projects and incidents consistent later."
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
              }}
              type="button"
            >
              <span>{tab.label}</span>
              <span className="catalog-tab-count">{tab.rows.length}</span>
            </button>
          );
        })}
      </div>

      <div className={showContextColumn ? "split-layout" : "list-layout"}>
        <SurfaceCard
          title={activeTabConfig.title}
          subtitle={activeTabConfig.subtitle}
          aside={
            <div className="surface-card-actions">
              <button
                className="ghost-control"
                disabled={!selectedRow}
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
                className="ghost-control"
                disabled={!selectedRow}
                onClick={() => {
                  if (!selectedRow || typeof selectedRow.id !== "string") {
                    return;
                  }

                  const singularLabel = singularLabelMap[activeTab];
                  const confirmed = window.confirm(`Delete this ${singularLabel}?`);
                  if (!confirmed) {
                    return;
                  }

                  void applyCatalogMutation(
                    () =>
                      deleteCatalogEntity({
                        entityType: activeTab,
                        id: selectedRow.id as string,
                      }),
                    null,
                  );
                }}
                type="button"
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
              <button
                className="action-primary-button"
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
            activeRowId={selectedIds[activeTab]}
            columns={activeTabConfig.columns}
            emptyMessage={`No ${activeTabConfig.label.toLowerCase()} yet. Create the first one to make this workspace operational.`}
            getRowId={(row) => String(row.id)}
            maxHeight="min(68vh, 760px)"
            onRowClick={(row) => setSelectedIds((current) => ({ ...current, [activeTab]: String(row.id) }))}
            onSortRequest={catalogControls.handleColumnSortRequest}
            persistKey={`catalog-${activeTab}`}
            rows={activeTabConfig.rows}
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

        {editorMode ? (
          <CatalogEditorPanel
            assetOptions={data.assetOptions}
            entityType={activeTab}
            error={editorError}
            initialValue={editorMode === "edit" ? selectedRow : null}
            isSubmitting={isSubmittingEditor}
            mode={editorMode}
            onClose={() => {
              setEditorMode(null);
              setEditorError(null);
            }}
            onSubmit={async (payload) =>
              applyCatalogMutation(
                () => (editorMode === "create" ? createCatalogEntity(payload as never) : updateCatalogEntity(payload as never)),
                editorMode === "edit" && typeof selectedRow?.id === "string" ? selectedRow.id : selectedIds[activeTab],
              )
            }
          />
        ) : showPreview && selectedRow ? (
          <SurfaceCard
            title={resolveCatalogPreviewTitle(activeTab, selectedRow)}
            subtitle={`Selected ${singularLabelMap[activeTab]} record.`}
            aside={
              <button
                aria-label="Close catalog preview"
                className="surface-card-action"
                onClick={() => setSelectedIds((current) => ({ ...current, [activeTab]: null }))}
                type="button"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Database</span>
                <span className="summary-value">{activeTabConfig.label}</span>
              </div>
              {buildCatalogPreviewRows(activeTab, selectedRow).map((row) => (
                <div key={row.label} className="summary-row">
                  <span className="summary-label">{row.label}</span>
                  <span className="summary-value">{row.value}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>
        ) : null}
      </div>
    </div>
  );
};
