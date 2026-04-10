export type CreateProjectInput = {
  code: string;
  name: string;
  clientId?: string;
  clientName?: string;
  status?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  colorKey?: string;
};

export type UpdateProjectInput = {
  projectId: string;
  code: string;
  name: string;
  clientId?: string;
  clientName?: string;
  status?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
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
