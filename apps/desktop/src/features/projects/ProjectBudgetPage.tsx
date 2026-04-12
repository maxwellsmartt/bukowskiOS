import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";

import { useProjectMode } from "./useProjectMode";
import { useProjectDetail } from "./useProjectsData";

export const ProjectBudgetPage = () => {
  const { project, projectId } = useProjectMode();
  const { data, error, isLoading } = useProjectDetail(projectId);

  if (error) {
    return <div className="empty-state">Project budget unavailable: {error}</div>;
  }

  if (isLoading) {
    return (
      <SurfaceCard title="Budget" subtitle="Loading project-linked entries, reserve and exposure context.">
        <TableSkeleton body="Preparing budget shell and cost-bearing incidents for this project." columns={4} />
      </SurfaceCard>
    );
  }

  if (!data.project) {
    return <div className="empty-state">Select a project to inspect its budget shell and operational exposure.</div>;
  }

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader title="Budget" />

      <div className="project-workspace-scroll">
        <div className="project-detail-support-grid">
          <SurfaceCard className="project-scroll-card" title="Budget shell">
            <div className="project-budget-grid">
              <div className="summary-row">
                <span className="summary-label">Total entries</span>
                <span className="summary-value">{data.budget.totalEntries}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Reserve</span>
                <span className="summary-value">{data.budget.reserve}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Exposure</span>
                <span className="summary-value">{data.budget.exposure}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Status</span>
                <span className="summary-value">{data.budget.status}</span>
              </div>
            </div>
            <p className="surface-card-subtitle project-budget-note">{data.budget.note}</p>
          </SurfaceCard>

          <SurfaceCard
            className="project-scroll-card"
            title="Project context"
          >
            <div className="chip-row">
              <StatusBadge>{data.project.client}</StatusBadge>
              <StatusBadge>{data.project.status}</StatusBadge>
              <StatusBadge tone="warning">{data.project.exposure}</StatusBadge>
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard
          className="project-scroll-card"
          title="Cost-bearing incidents"
        >
          <DataTable
            columns={[
              {
                key: "incident",
                label: "Incident",
                width: 260,
                minWidth: 190,
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.title}</span>
                    <span className="identity-meta">{row.asset}</span>
                  </div>
                ),
              },
              { key: "responsible", label: "Responsible", width: 160, minWidth: 128, render: (row) => row.responsible },
              { key: "severity", label: "Severity", width: 100, minWidth: 88, render: (row) => row.severity },
              { key: "costEstimate", label: "Estimate", align: "right", width: 120, minWidth: 100, render: (row) => row.costEstimate },
              { key: "status", label: "Status", width: 110, minWidth: 92, render: (row) => row.status },
            ]}
            getRowId={(row) => row.id}
            maxHeight="min(46vh, 420px)"
            persistKey="project-budget-incidents"
            rows={data.incidents}
          />
        </SurfaceCard>
      </div>
    </div>
  );
};
