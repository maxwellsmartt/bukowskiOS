import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.2";

type SendInvitePayload = {
  workspaceId: string;
  email: string;
  roleId: string;
  message?: string;
};

type SupabaseAuthUser = {
  id: string;
};

const allowedOrigins = [/^https?:\/\/localhost(?::\d+)?$/, /^https?:\/\/127\.0\.0\.1(?::\d+)?$/];

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  const allowOrigin = allowedOrigins.some((allowedOrigin) => allowedOrigin.test(origin)) ? origin : "";

  return {
    ...(allowOrigin ? { "access-control-allow-origin": allowOrigin } : {}),
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
};

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(request) },
  });

const readBearerToken = (request: Request) => {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

const getAuthenticatedUser = async (supabaseUrl: string, anonKey: string, bearerToken: string) => {
  if (!bearerToken) {
    return { user: null, error: "missing_bearer_token" };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  if (!response.ok) {
    return { user: null, error: `auth_user_lookup_failed_${response.status}` };
  }

  const user = (await response.json()) as SupabaseAuthUser;
  return user.id ? { user, error: null } : { user: null, error: "auth_user_missing_id" };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  if (request.method !== "POST") {
    return json(request, { error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(request, { error: "missing_supabase_env" }, 500);
  }

  const bearerToken = readBearerToken(request);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: bearerToken ? `Bearer ${bearerToken}` : "" } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const payload = (await request.json()) as SendInvitePayload;

  const { data: allowed, error: permissionError } = await userClient.rpc("has_permission", {
    target_workspace_id: payload.workspaceId,
    permission_key: "users.invite",
  });

  if (permissionError || allowed !== true) {
    return json(request, { error: "forbidden" }, 403);
  }

  const caller = await getAuthenticatedUser(supabaseUrl, anonKey, bearerToken);
  const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(payload.email, {
    redirectTo: "bukowskios://auth/accept-invite",
    data: {
      workspace_id: payload.workspaceId,
      role_id: payload.roleId,
      message: payload.message ?? null,
    },
  });

  if (inviteError || !invite.user) {
    return json(request, { error: inviteError?.message ?? "invite_failed" }, 400);
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
    return json(request, { error: membershipError.message }, 400);
  }

  return json(request, { ok: true, userId: invite.user.id });
});
