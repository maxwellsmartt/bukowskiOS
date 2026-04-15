import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.2";

type SendInvitePayload = {
  workspaceId: string;
  email: string;
  roleId: string;
  message?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "missing_supabase_env" }, 500);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const payload = (await request.json()) as SendInvitePayload;

  const { data: allowed, error: permissionError } = await userClient.rpc("has_permission", {
    target_workspace_id: payload.workspaceId,
    permission_key: "users.invite",
  });

  if (permissionError || allowed !== true) {
    return json({ error: "forbidden" }, 403);
  }

  const { data: caller } = await userClient.auth.getUser();
  const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(payload.email, {
    redirectTo: "bukowskios://auth/accept-invite",
    data: {
      workspace_id: payload.workspaceId,
      role_id: payload.roleId,
      message: payload.message ?? null,
    },
  });

  if (inviteError || !invite.user) {
    return json({ error: inviteError?.message ?? "invite_failed" }, 400);
  }

  const { error: membershipError } = await adminClient.from("workspace_memberships").upsert({
    workspace_id: payload.workspaceId,
    user_id: invite.user.id,
    role_id: payload.roleId,
    status: "invited",
    invited_by: caller.user?.id ?? null,
    invited_at: new Date().toISOString(),
  });

  if (membershipError) {
    return json({ error: membershipError.message }, 400);
  }

  return json({ ok: true, userId: invite.user.id });
});
