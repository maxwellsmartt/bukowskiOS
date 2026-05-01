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
): Promise<{ userId: string }> => {
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

  const payload = (await response.json()) as { userId?: string };
  if (!payload.userId) {
    throw new Error("Invite was sent but the response did not include a user id.");
  }

  return { userId: payload.userId };
};
