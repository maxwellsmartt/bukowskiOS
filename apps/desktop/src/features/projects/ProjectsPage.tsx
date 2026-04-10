import { useState } from "react";

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
  const { activeProjectId, setActiveProjectId } = useShellContext();
  const sectionScopeLabel = useSectionScopeLabel();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = useProjectDetail(activeProjectId);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Projects"
        title="Project registry"
        body="Projects now carry operational detail: assigned assets, incidents, responsibles and a first budget shell. Project CRUD still lives in the sidebar."
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Projects unavailable: {error}</div> : null}

      <div className="projects-layout">
        <SurfaceCard title="Projects" subtitle="Select a project from the sidebar or inspect the full workspace registry here.">
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
