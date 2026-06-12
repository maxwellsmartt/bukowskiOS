import type { ProjectCardRow } from "../queries/operations-queries";

export type CreateProjectInput = {
  workspaceId: string;
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
  confirmedWithBackup: true;
};

export type ArchiveProjectInput = {
  projectId: string;
};

export type UnarchiveProjectInput = {
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

export type AddDepartmentToProjectUnitInput = {
  projectId: string;
  unitId: string;
  departmentId: string;
};

export type AssignCrewToProjectUnitInput = {
  projectId: string;
  unitId: string;
  departmentId: string;
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

export type ProjectBlueprintPackingSeed =
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
      responsibleUserId?: string;
      notes?: string;
    };

export type ProjectBlueprintUnitWindowInput = {
  id?: string;
  startDate?: string;
  endDate?: string;
  sortOrder?: number;
  label?: string;
};

export type ProjectBlueprintUnitDepartmentDraftInput = {
  departmentId: string;
  assetIds: string[];
  crewAssignments: ProjectBlueprintCrewDraftInput[];
  packingSeed?: ProjectBlueprintPackingSeed;
};

export type ProjectBlueprintUnitDraftInput = {
  id?: string;
  code?: string;
  name: string;
  suggestedPreset?: string;
  sortOrder?: number;
  colorKey?: string;
  windows: ProjectBlueprintUnitWindowInput[];
  departmentIds: string[];
  unitDepartments: ProjectBlueprintUnitDepartmentDraftInput[];
  notes?: string;
};

export type ProjectBlueprintGeneralInfoInput = {
  code?: string;
  name: string;
  clientId?: string;
  clientName?: string;
  productionCompanyId?: string;
  productionCompanyName?: string;
  status: string;
  description?: string;
  startDate: string;
  endDate: string;
  hasPreproduction?: boolean;
  preproductionStartDate?: string;
  preproductionEndDate?: string;
  colorKey: string;
  departmentIds: string[];
};

export type CreateProjectBlueprintInput = {
  workspaceId: string;
  generalInfo: ProjectBlueprintGeneralInfoInput;
  mainUnit: ProjectBlueprintUnitDraftInput;
  additionalUnits: ProjectBlueprintUnitDraftInput[];
};

export type CreateProjectBlueprintResult = {
  createdProjectId: string;
  projects: ProjectCardRow[];
};
