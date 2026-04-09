export type Asset = {
  id: string;
  workspaceId: string;
  categoryId: string;
  name: string;
  internalCode: string;
  serialNumber?: string;
  replacementValue?: number;
  currency?: string;
  defaultLocationId?: string;
  isActive: boolean;
};

export type AssetCurrentState = {
  assetId: string;
  workspaceId: string;
  currentLocationId?: string;
  currentProjectId?: string;
  currentDepartmentId?: string;
  currentResponsibleUserId?: string;
  activeAssignmentId?: string;
  conditionStatus: string;
  operationalStatus: string;
  custodyStatus: string;
  lastEventId: string;
  version: number;
};
