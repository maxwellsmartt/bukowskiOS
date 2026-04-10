import { IncidentsPage } from "@features/incidents/IncidentsPage";

import { useProjectMode } from "./useProjectMode";

export const ProjectIncidentsPage = () => {
  const { project, projectId } = useProjectMode();

  return <IncidentsPage projectId={projectId} projectName={project?.name ?? null} />;
};
