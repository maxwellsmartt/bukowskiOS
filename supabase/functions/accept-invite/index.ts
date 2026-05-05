import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.2";

type SupabaseAuthUser = {
  id: string;
};

type AcceptInvitePayload = {
  workspaceId?: string | null;
};

type WorkspaceMembershipRow = {
  workspace_id: string;
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

const normalizeWorkspaceId = (workspaceId: unknown) => {
  if (typeof workspaceId !== "string") {
    return null;
  }

  const trimmed = workspaceId.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readPayload = async (request: Request): Promise<AcceptInvitePayload> => {
  try {
    return (await request.json()) as AcceptInvitePayload;
  } catch {
    return {};
  }
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
  const caller = await getAuthenticatedUser(supabaseUrl, anonKey, bearerToken);

  if (!caller.user) {
    return json(request, { error: caller.error ?? "unauthenticated" }, 401);
  }

  const payload = await readPayload(request);
  const workspaceId = normalizeWorkspaceId(payload.workspaceId);
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date().toISOString();

  let inviteQuery = adminClient
    .from("workspace_memberships")
    .update({
      status: "active",
      accepted_at: now,
      updated_at: now,
    })
    .eq("user_id", caller.user.id)
    .eq("status", "invited")
    .select("workspace_id");

  if (workspaceId) {
    inviteQuery = inviteQuery.eq("workspace_id", workspaceId);
  }

  const { data: acceptedRows, error: acceptError } = await inviteQuery;

  if (acceptError) {
    return json(request, { error: acceptError.message }, 400);
  }

  const acceptedWorkspaceIds = ((acceptedRows ?? []) as WorkspaceMembershipRow[])
    .map((row) => row.workspace_id)
    .filter(Boolean);

  if (acceptedWorkspaceIds.length > 0) {
    return json(request, {
      ok: true,
      accepted: true,
      workspaceIds: acceptedWorkspaceIds,
    });
  }

  let activeQuery = adminClient
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", caller.user.id)
    .eq("status", "active");

  if (workspaceId) {
    activeQuery = activeQuery.eq("workspace_id", workspaceId);
  }

  const { data: activeRows, error: activeError } = await activeQuery;

  if (activeError) {
    return json(request, { error: activeError.message }, 400);
  }

  return json(request, {
    ok: true,
    accepted: false,
    alreadyActive: ((activeRows ?? []) as WorkspaceMembershipRow[]).length > 0,
    workspaceIds: ((activeRows ?? []) as WorkspaceMembershipRow[]).map((row) => row.workspace_id).filter(Boolean),
  });
});
