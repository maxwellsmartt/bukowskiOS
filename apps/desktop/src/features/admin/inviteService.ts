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
  input: RevokeWorkspaceInviteInput & { workspaceId: string },
): Promise<void> => {
  void supabase;
  if (!window.bukowskiApp?.revokeWorkspaceInvite) {
    throw new Error("The secure invite bridge is unavailable.");
  }
  await window.bukowskiApp.revokeWorkspaceInvite(input);
};

export const updateMemberRole = async (
  supabase: SupabaseClient,
  input: { workspaceId: string; userId: string; roleId: string },
): Promise<void> => {
  void supabase;
  if (!window.bukowskiApp?.updateWorkspaceMemberRole) {
    throw new Error("The secure member bridge is unavailable.");
  }
  await window.bukowskiApp.updateWorkspaceMemberRole(input);
};

export const setMemberStatus = async (
  supabase: SupabaseClient,
  input: { workspaceId: string; userId: string; status: "active" | "inactive" },
): Promise<void> => {
  void supabase;
  if (!window.bukowskiApp?.setWorkspaceMemberStatus) {
    throw new Error("The secure member bridge is unavailable.");
  }
  await window.bukowskiApp.setWorkspaceMemberStatus(input);
};
