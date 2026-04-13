export type CreateProjectInput = {
  code: string;
  name: string;
  clientId?: string;
  clientName?: string;
  productionCompanyId?: string;
  productionCompanyName?: string;
  status?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  hasPreproduction?: boolean;
  preproductionStartDate?: string;
  preproductionEndDate?: string;
  colorKey?: string;
};

export type UpdateProjectInput = {
  projectId: string;
  code: string;
  name: string;
  clientId?: string;
  clientName?: string;
  productionCompanyId?: string;
  productionCompanyName?: string;
  status?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  hasPreproduction?: boolean;
  preproductionStartDate?: string;
  preproductionEndDate?: string;
  colorKey?: string;
};

export type DeleteProjectInput = {
  projectId: string;
};

export type CreateProjectUnitInput = {
  projectId: string;
  code: string;
  name: string;
  sortOrder?: number;
  colorKey?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
};

export type UpdateProjectUnitInput = {
  projectId: string;
  unitId: string;
  code: string;
  name: string;
  sortOrder: number;
  colorKey?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  statusAction?: "none" | "mark_wrapped" | "cancel" | "reactivate";
};

export type DeleteProjectUnitInput = {
  projectId: string;
  unitId: string;
};

export type AssignCrewToProjectUnitInput = {
  projectId: string;
  unitId: string;
  crewMemberId: string;
  roleLabel?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
};

export type UnassignCrewFromProjectUnitInput = {
  projectId: string;
  unitId: string;
  assignmentId: string;
};

export type ProjectBlueprintCrewDraftInput = {
  crewMemberId: string;
  roleLabel?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
};

export type ProjectBlueprintUnitDraftInput = {
  id?: string;
  code?: string;
  name: string;
  suggestedPreset?: string;
  sortOrder?: number;
  colorKey?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  assetIds: string[];
  crewAssignments: ProjectBlueprintCrewDraftInput[];
};

export type ProjectBlueprintPackingSelection =
  | {
      mode: "none";
    }
  | {
      mode: "existing";
      packingSlipId: string;
    }
  | {
      mode: "draft";
      label?: string;
      departmentId?: string;
      responsibleUserId?: string;
      notes?: string;
    };

export type CreateProjectBlueprintInput = {
  generalInfo: CreateProjectInput;
  mainUnit: ProjectBlueprintUnitDraftInput;
  additionalUnits: ProjectBlueprintUnitDraftInput[];
  packingSelection: ProjectBlueprintPackingSelection;
};
