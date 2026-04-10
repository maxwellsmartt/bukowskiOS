import { useState } from "react";

import { useCompareTray } from "@app/providers/CompareTrayContext";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { useProjectDetail, useProjectsData } from "./useProjectsData";

export const ProjectsPage = () => {
  const { data, error } = useProjectsData();
  const { activeProjectId, openProject, setActiveProjectId } = useShellContext();
  const { addItems, hasItem } = useCompareTray();
  const sectionScopeLabel = useSectionScopeLabel();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = useProjectDetail(activeProjectId);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Projects"
        title="Project registry"
        body="Global registry for opening project workspaces, reviewing current exposure and managing the operational base of each project."
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Projects unavailable: {error}</div> : null}

      <div className="chip-row">
        <StatusBadge tone="info">Workspace registry</StatusBadge>
        <StatusBadge tone="success">{data.filter((project) => hasItem("project", project.id)).length} in compare</StatusBadge>
        <StatusBadge>{selectedRowIds.length ? `${selectedRowIds.length} selected` : "Double click opens project workspace"}</StatusBadge>
      </div>

      {selectedRowIds.length ? (
        <div className="selection-action-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">
              {selectedRowIds.length === 1 ? "1 project selected" : `${selectedRowIds.length} projects selected`}
            </span>
            <span className="selection-action-subtitle">
              Keep projects in the compare tray to prepare future side-by-side schedule, resource and budget review.
            </span>
          </div>
          <div className="selection-action-buttons">
            <button
              className="ghost-control"
              onClick={() =>
                addItems(
                  data
                    .filter((project) => selectedRowIds.includes(project.id))
                    .map((project) => ({
                      id: project.id,
                      entityType: "project" as const,
                      label: `${project.code} · ${project.name}`,
                      subtitle: `${project.client} · ${project.status}`,
                      meta: project.startDate || project.endDate ? `${project.startDate ?? "Open"} - ${project.endDate ?? "Open"}` : undefined,
                    })),
                )
              }
              type="button"
            >
              Add to compare
            </button>
          </div>
        </div>
      ) : null}

      <div className="projects-layout">
        <SurfaceCard title="Projects" subtitle="Single click inspects the registry. Double click opens the project workspace.">
          <DataTable
            activeRowId={activeProjectId}
            columns={[
              {
                key: "project",
                label: "Project",
                width: 250,
                minWidth: 180,
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.name}</span>
                    <span className="identity-meta">
                      {row.code} · {row.client}
                    </span>
                  </div>
                ),
              },
              {
                key: "status",
                label: "Status",
                width: 96,
                minWidth: 86,
                render: (row) => <StatusBadge>{row.status}</StatusBadge>,
              },
              {
                key: "startDate",
                label: "Start",
                width: 108,
                minWidth: 92,
                render: (row) => row.startDate ?? "—",
              },
              {
                key: "endDate",
                label: "End",
                width: 108,
                minWidth: 92,
                render: (row) => row.endDate ?? "—",
              },
              {
                key: "colorKey",
                label: "Color",
                width: 94,
                minWidth: 82,
                render: (row) => row.colorKey ?? "Default",
              },
              {
                key: "activeUnitCount",
                label: "Units",
                align: "right",
                width: 74,
                minWidth: 62,
                render: (row) => row.activeUnitCount,
              },
              { key: "assets", label: "Assets", align: "right", width: 80, minWidth: 68, render: (row) => row.assetCount },
              {
                key: "incidents",
                label: "Incidents",
                align: "right",
                width: 88,
                minWidth: 74,
                render: (row) => row.incidentCount,
              },
              { key: "departments", label: "Departments", width: 210, minWidth: 170, render: (row) => row.departments },
              { key: "exposure", label: "Exposure", align: "right", width: 110, minWidth: 96, render: (row) => row.exposure },
              { key: "description", label: "Description", width: 260, minWidth: 220, render: (row) => row.description },
            ]}
            getRowId={(row) => row.id}
            maxHeight="min(72vh, 760px)"
            onRowClick={(row) => setActiveProjectId(row.id)}
            onRowDoubleClick={(row) => openProject(row.id)}
            persistKey="projects-registry"
            rows={data}
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        <ProjectDetailPanel data={detail} error={detailError} isLoading={detailLoading} onIncidentCreated={reloadDetail} />
      </div>
    </div>
  );
};
