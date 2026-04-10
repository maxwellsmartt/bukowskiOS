import { PackingPage } from "@features/packing/PackingPage";

import { useProjectMode } from "./useProjectMode";

export const ProjectPackingPage = () => {
  const { project, projectId } = useProjectMode();

  return <PackingPage projectId={projectId} projectName={project?.name ?? null} />;
};
