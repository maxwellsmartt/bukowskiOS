import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { projects } from "@shared/lib/sample-data";

export const ProjectsPage = () => (
  <div className="page-stack">
    <SectionHeader
      eyebrow="Project context"
      title="Project-aware, not project-trapped"
      body="Project context needs to enrich operational decisions without collapsing the whole app into a tree of projects."
    />

    <div className="project-grid">
      {projects.map((project) => (
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
