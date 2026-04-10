import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useProjectMode } from "./useProjectMode";
import { useProjectDetail } from "./useProjectsData";

export const ProjectInfoPage = () => {
  const { project, projectId } = useProjectMode();
  const { data, error, isLoading } = useProjectDetail(projectId);

  if (error) {
    return <div className="empty-state">Project info unavailable: {error}</div>;
  }

  if (isLoading) {
    return <div className="empty-state">Loading project info...</div>;
  }

  if (!data.project) {
    return <div className="empty-state">Select a project to inspect its info, context and responsibles.</div>;
  }

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Project / Info"
        title={`${data.project.name} info`}
        body="Base context, client linkage, exposure and responsibles tied to this specific project."
        contextLabel={project ? `${project.code} · ${project.name}` : "Project workspace"}
      />

      <div className="project-detail-support-grid">
        <SurfaceCard
          title={`${data.project.code} · ${data.project.name}`}
          subtitle={data.project.description || "No project description yet."}
          aside={<StatusBadge>{data.project.status}</StatusBadge>}
        >
          <div className="summary-grid">
            <div className="summary-row">
              <span className="summary-label">Client</span>
              <span className="summary-value">{data.project.client}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Departments</span>
              <span className="summary-value">{data.project.departments}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Assigned assets</span>
              <span className="summary-value">{data.project.assetCount}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Incidents</span>
              <span className="summary-value">{data.project.incidentCount}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Exposure</span>
              <span className="summary-value">{data.project.exposure}</span>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Responsibles" subtitle="People currently carrying inventory or incident follow-up inside this project.">
          {data.responsibles.length ? (
            <div className="queue-list">
              {data.responsibles.map((row) => (
                <div key={row.name} className="queue-item">
                  <div className="identity-cell">
                    <span className="identity-title">{row.name}</span>
                    <span className="identity-meta">
                      {row.assetCount} assets · {row.incidentCount} open incidents
                    </span>
                  </div>
                  <StatusBadge tone={row.incidentCount ? "critical" : "info"}>
                    {row.incidentCount ? "Needs follow-up" : "Stable"}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No responsibles linked yet. Assign assets or incidents to build project ownership.</div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};
