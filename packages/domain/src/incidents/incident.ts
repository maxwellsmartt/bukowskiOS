export type Incident = {
  id: string;
  workspaceId: string;
  assetId?: string;
  projectId?: string;
  departmentId?: string;
  assignmentId?: string;
  reportedByUserId: string;
  incidentType: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  reportedAt: string;
  costEstimate?: number;
  currency?: string;
  financialStatus?: string;
};
