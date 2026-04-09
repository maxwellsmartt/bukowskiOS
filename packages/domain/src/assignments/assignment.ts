export type AssetAssignment = {
  id: string;
  workspaceId: string;
  assetId: string;
  projectId?: string;
  departmentId?: string;
  assignedToUserId?: string;
  assignedByUserId: string;
  sourceLocationId?: string;
  targetLocationId?: string;
  assignmentStatus: string;
  checkedOutAt?: string;
  expectedReturnAt?: string;
  returnedAt?: string;
  notes?: string;
};
