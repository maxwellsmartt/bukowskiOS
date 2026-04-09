export type CreateProjectInput = {
  code: string;
  name: string;
  clientName?: string;
  status?: string;
  description?: string;
};

export type UpdateProjectInput = {
  projectId: string;
  code: string;
  name: string;
  clientName?: string;
  status?: string;
  description?: string;
};

export type DeleteProjectInput = {
  projectId: string;
};
