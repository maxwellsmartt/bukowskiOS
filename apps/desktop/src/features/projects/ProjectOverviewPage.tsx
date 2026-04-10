import { SectionHeader } from "@shared/components/SectionHeader";

import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { useProjectMode } from "./useProjectMode";
import { useProjectDetail } from "./useProjectsData";

export const ProjectOverviewPage = () => {
  const { project, projectId } = useProjectMode();
  const { data, error, isLoading, reload } = useProjectDetail(projectId);

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader
        eyebrow="Project / Overview"
        title={project ? `${project.name}` : "Project overview"}
        body="Assets, incidents, crew and budget signals for the selected project."
        contextLabel={project ? `${project.code} · ${project.name}` : "Project workspace"}
      />

      <div className="project-workspace-scroll">
        <ProjectDetailPanel data={data} error={error} isLoading={isLoading} onIncidentCreated={reload} />
      </div>
    </div>
  );
};
