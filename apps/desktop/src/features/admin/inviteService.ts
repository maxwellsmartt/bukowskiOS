import type { SupabaseClient } from "@supabase/supabase-js";

export type SendWorkspaceInviteInput = {
  workspaceId: string;
  email: string;
  roleId: string;
  message?: string | null;
};

export const sendWorkspaceInvite = async (
  supabase: SupabaseClient,
  input: SendWorkspaceInviteInput,
): Promise<{ alreadyRegistered: boolean; magicLinkSent: boolean; membershipStatus: "active" | "invited"; warning: string | null; userId: string }> => {
  void supabase;
  if (!window.bukowskiApp?.sendWorkspaceInvite) {
    throw new Error("The secure invite bridge is unavailable.");
  }

  const payload = await window.bukowskiApp.sendWorkspaceInvite({
    workspaceId: input.workspaceId,
    email: input.email.trim().toLowerCase(),
    roleId: input.roleId,
    message: input.message?.trim() ? input.message.trim() : null,
  });
  if (!payload?.userId) {
    throw new Error("Invite was sent but the response did not include a user id.");
  }

  return {
    alreadyRegistered: Boolean(payload.alreadyRegistered),
    magicLinkSent: payload.magicLinkSent !== false,
    membershipStatus: payload.membershipStatus ?? "invited",
    warning: payload.warning ?? null,
    userId: payload.userId,
  };
};

export type RevokeWorkspaceInviteInput = {
  membershipId: string;
};

export const revokeWorkspaceInvite = async (
  supabase: SupabaseClient,
  input: RevokeWorkspaceInviteInput,
): Promise<void> => {
  const { error: deleteError } = await supabase
    .from("workspace_memberships")
    .delete()
    .eq("id", input.membershipId)
    .eq("status", "invited");

  if (deleteError) {
    throw new Error(deleteError.message);
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const looseClient = (client: SupabaseClient): any => client as unknown;

export const updateMemberRole = async (
  supabase: SupabaseClient,
  input: { workspaceId: string; userId: string; roleId: string },
): Promise<void> => {
  const { error } = await looseClient(supabase)
    .from("workspace_memberships")
    .update({ role_id: input.roleId, updated_at: new Date().toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId);

  if (error) {
    throw new Error(error.message);
  }
};

export const setMemberStatus = async (
  supabase: SupabaseClient,
  input: { workspaceId: string; userId: string; status: "active" | "inactive" },
): Promise<void> => {
  const { error } = await looseClient(supabase)
    .from("workspace_memberships")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId);

  if (error) {
    throw new Error(error.message);
  }
};
