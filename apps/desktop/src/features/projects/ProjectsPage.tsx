import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useProjectsData } from "./useProjectsData";

export const ProjectsPage = () => {
  const { data, error } = useProjectsData();

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Project context"
        title="Project-aware, not project-trapped"
        body="Project context needs to enrich operational decisions without collapsing the whole app into a tree of projects."
      />

      {error ? <div className="empty-state">Projects unavailable: {error}</div> : null}

      <div className="project-grid">
        {data.map((project) => (
          <SurfaceCard key={project.name} title={project.name} subtitle={project.client} aside={<StatusBadge>{project.status}</StatusBadge>}>
            <div className="summary-row">
              <span className="summary-label">Departments</span>
              <span className="summary-value">{project.departments}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Exposure</span>
              <span className="summary-value">{project.exposure}</span>
            </div>
          </SurfaceCard>
        ))}
      </div>
    </div>
  );
};
