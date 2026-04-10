export type Project = {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  clientName?: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  colorKey?: string | null;
};
