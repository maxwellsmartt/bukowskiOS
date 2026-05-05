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
  const payload = {
    workspace_id: input.workspaceId,
    key: input.key,
    name: input.name,
    description: input.description || null,
    is_system_role: false,
  };

  const { data, error } = await loose(supabase)
    .from("roles")
    .insert(payload)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create role");
  }

  return { roleId: (data as { id: string }).id };
};

export const deleteCustomRole = async (
  supabase: SupabaseClient,
  roleId: string,
): Promise<void> => {
  const { error } = await loose(supabase).from("roles").delete().eq("id", roleId);
  if (error) {
    throw new Error(error.message);
  }
};

export const updateCustomRole = async (
  supabase: SupabaseClient,
  input: { roleId: string; name: string; description: string },
): Promise<void> => {
  const payload = {
    name: input.name,
    description: input.description || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await loose(supabase)
    .from("roles")
    .update(payload)
    .eq("id", input.roleId);

  if (error) {
    throw new Error(error.message);
  }
};

export const grantPermission = async (
  supabase: SupabaseClient,
  roleId: string,
  permissionId: string,
): Promise<void> => {
  const { error } = await loose(supabase)
    .from("role_permissions")
    .insert({ role_id: roleId, permission_id: permissionId });

  if (error) {
    throw new Error(error.message);
  }
};

export const revokePermission = async (
  supabase: SupabaseClient,
  roleId: string,
  permissionId: string,
): Promise<void> => {
  const { error } = await loose(supabase)
    .from("role_permissions")
    .delete()
    .eq("role_id", roleId)
    .eq("permission_id", permissionId);

  if (error) {
    throw new Error(error.message);
  }
};
