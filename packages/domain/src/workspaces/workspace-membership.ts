export type Workspace = {
  id: string;
  slug: string;
  name: string;
  baseCurrency: string;
  isActive: boolean;
};

export type WorkspaceMembership = {
  id: string;
  workspaceId: string;
  userId: string;
  roleId: string;
  status: string;
  joinedAt: string;
};
