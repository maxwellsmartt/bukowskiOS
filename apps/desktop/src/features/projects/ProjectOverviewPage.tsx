import { SectionHeader } from "@shared/components/SectionHeader";

import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { useProjectMode } from "./useProjectMode";
import { useProjectDetail } from "./useProjectsData";

export const ProjectOverviewPage = () => {
  const { projectId } = useProjectMode();
  const { data, error, isLoading, reload } = useProjectDetail(projectId);

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader title="Overview" />

      <div className="project-workspace-scroll">
        <ProjectDetailPanel data={data} error={error} isLoading={isLoading} onIncidentCreated={reload} />
      </div>
    </div>
  );
};
