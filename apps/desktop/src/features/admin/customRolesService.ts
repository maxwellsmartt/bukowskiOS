import type { SupabaseClient } from "@supabase/supabase-js";

export type RolePermissionRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissionIds: string[];
  permissionKeys: string[];
};

export type PermissionDefinition = {
  id: string;
  key: string;
  label: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (client: SupabaseClient): any => client as unknown;

export const loadRolesWithPermissions = async (
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<RolePermissionRow[]> => {
  const { data, error } = await loose(supabase)
    .from("roles")
    .select("id,key,name,description,is_system_role,role_permissions(permission_id,permissions(key))")
    .eq("workspace_id", workspaceId)
    .order("is_system_role", { ascending: false })
    .order("name");

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const permissionsLink = (row.role_permissions ?? []) as Array<{
      permission_id: string;
      permissions?: { key?: string | null } | null;
    }>;

    return {
      id: row.id as string,
      key: row.key as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      isSystemRole: Boolean(row.is_system_role),
      permissionIds: permissionsLink.map((entry) => entry.permission_id),
      permissionKeys: permissionsLink
        .map((entry) => entry.permissions?.key)
        .filter((key): key is string => typeof key === "string" && key.length > 0),
    };
  });
};

export const loadAllPermissions = async (
  supabase: SupabaseClient,
): Promise<PermissionDefinition[]> => {
  const { data, error } = await loose(supabase)
    .from("permissions")
    .select("id,key,label")
    .order("key");

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    key: row.key as string,
    label: (row.label as string) ?? (row.key as string),
  }));
};

export const createCustomRole = async (
  supabase: SupabaseClient,
  input: { workspaceId: string; key: string; name: string; description: string },
): Promise<{ roleId: string }> => {
  void supabase;
  if (!window.bukowskiApp?.createCustomRole) {
    throw new Error("The secure role bridge is unavailable.");
  }
  return window.bukowskiApp.createCustomRole(input);
};

export const deleteCustomRole = async (
  supabase: SupabaseClient,
  workspaceId: string,
  roleId: string,
): Promise<void> => {
  void supabase;
  if (!window.bukowskiApp?.deleteCustomRole) {
    throw new Error("The secure role bridge is unavailable.");
  }
  await window.bukowskiApp.deleteCustomRole({ workspaceId, roleId });
};

export const updateCustomRole = async (
  supabase: SupabaseClient,
  input: { workspaceId: string; roleId: string; name: string; description: string },
): Promise<void> => {
  void supabase;
  if (!window.bukowskiApp?.updateCustomRole) {
    throw new Error("The secure role bridge is unavailable.");
  }
  await window.bukowskiApp.updateCustomRole(input);
};

export const grantPermission = async (
  supabase: SupabaseClient,
  workspaceId: string,
  roleId: string,
  permissionId: string,
): Promise<void> => {
  void supabase;
  if (!window.bukowskiApp?.setRolePermission) {
    throw new Error("The secure role bridge is unavailable.");
  }
  await window.bukowskiApp.setRolePermission({ workspaceId, roleId, permissionId, enabled: true });
};

export const revokePermission = async (
  supabase: SupabaseClient,
  workspaceId: string,
  roleId: string,
  permissionId: string,
): Promise<void> => {
  void supabase;
  if (!window.bukowskiApp?.setRolePermission) {
    throw new Error("The secure role bridge is unavailable.");
  }
  await window.bukowskiApp.setRolePermission({ workspaceId, roleId, permissionId, enabled: false });
};
