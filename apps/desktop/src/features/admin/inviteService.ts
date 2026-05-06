import type { SupabaseClient } from "@supabase/supabase-js";

export type SendWorkspaceInviteInput = {
  workspaceId: string;
  email: string;
  roleId: string;
  message?: string | null;
};

const readFunctionErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof payload.error === "string") {
      return payload.error;
    }
    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // ignore JSON parsing errors and fall back to status text
  }
  return response.statusText;
};

export const sendWorkspaceInvite = async (
  supabase: SupabaseClient,
  input: SendWorkspaceInviteInput,
): Promise<{ alreadyRegistered: boolean; magicLinkSent: boolean; membershipStatus: "active" | "invited"; warning: string | null; userId: string }> => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) {
    throw new Error(sessionError?.message ?? "An authenticated session is required to send invites.");
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase is not configured. Invites require VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/send-invite`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      email: input.email.trim().toLowerCase(),
      roleId: input.roleId,
      message: input.message?.trim() ? input.message.trim() : null,
    }),
  });

  if (!response.ok) {
    const detail = await readFunctionErrorMessage(response);
    if (response.status === 403) {
      throw new Error("You do not have permission to invite members in this workspace.");
    }
    throw new Error(`Invite failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    alreadyRegistered?: boolean;
    magicLinkSent?: boolean;
    membershipStatus?: "active" | "invited";
    userId?: string;
    warning?: string;
  };
  if (!payload.userId) {
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
