import { AssetsPage } from "@features/assets/AssetsPage";

import { useProjectMode } from "./useProjectMode";

export const ProjectAssetsPage = () => {
  const { project, projectId } = useProjectMode();

  return <AssetsPage projectId={projectId} projectName={project?.name ?? null} />;
};
