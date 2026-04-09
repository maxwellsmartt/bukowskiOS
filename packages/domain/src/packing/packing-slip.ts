export type PackingSlip = {
  id: string;
  workspaceId: string;
  projectId: string;
  departmentId?: string;
  preparedByUserId: string;
  responsibleUserId?: string;
  status: string;
  issueDate: string;
  returnDueDate?: string;
};
