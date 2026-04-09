export type FinancialEntry = {
  id: string;
  workspaceId: string;
  entryType: string;
  category: string;
  amount: number;
  currency: string;
  status: string;
  projectId?: string;
  assetId?: string;
  incidentId?: string;
};
