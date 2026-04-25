import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.2";

type BootstrapPayload = {
  name: string;
  slug: string;
  baseCurrency?: string;
  iconColor?: string;
};

type SupabaseAuthUser = {
  id: string;
};

const allowedOrigins = [/^https?:\/\/localhost(?::\d+)?$/, /^https?:\/\/127\.0\.0\.1(?::\d+)?$/];

const adminPermissions = [
  { key: "assets.read", label: "Read assets", description: "View asset registry and current state" },
  { key: "assets.manage", label: "Manage assets", description: "Create movements and update assets" },
  { key: "incidents.read", label: "Read incidents", description: "View incident queues and details" },
  { key: "incidents.create", label: "Create incidents", description: "Report, update and resolve incidents" },
  { key: "packing-slips.read", label: "Read packing slips", description: "View packing slip detail and status" },
  { key: "packing-slips.create", label: "Create packing slips", description: "Issue and return packing slips" },
  { key: "finance.read", label: "Read finance", description: "View finance exposure and entries" },
  { key: "rma.read", label: "Read RMAs", description: "Review RMA queues and manufacturer cases" },
  { key: "rma.create", label: "Create RMAs", description: "Open or prepare new RMA cases" },
];

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
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const caller = await getAuthenticatedUser(supabaseUrl, anonKey, bearerToken);

  if (caller.error || !caller.user) {
    return json(request, { error: "authentication_required", detail: caller.error }, 401);
  }

  const payload = (await request.json()) as BootstrapPayload;
  const now = new Date().toISOString();
  const { data: workspace, error: workspaceError } = await adminClient
    .from("workspaces")
    .upsert(
      {
        name: payload.name,
        slug: payload.slug,
        base_currency: payload.baseCurrency ?? "USD",
        icon_color: payload.iconColor ?? null,
        updated_at: now,
      },
      {
        onConflict: "slug",
        ignoreDuplicates: false,
      },
    )
    .select("id")
    .single();

  if (workspaceError || !workspace) {
    return json(request, { error: workspaceError?.message ?? "workspace_create_failed" }, 400);
  }

  const { data: adminRole, error: roleError } = await adminClient
    .from("roles")
    .upsert(
      {
        workspace_id: workspace.id,
        key: "admin",
        name: "Admin",
        description: "System admin role. Clone to customize.",
        is_system_role: true,
        updated_at: now,
      },
      {
        onConflict: "workspace_id,key",
        ignoreDuplicates: false,
      },
    )
    .select("id")
    .single();

  if (roleError || !adminRole) {
    return json(request, { error: roleError?.message ?? "role_create_failed" }, 400);
  }

  const { data: permissions, error: permissionsError } = await adminClient
    .from("permissions")
    .upsert(adminPermissions, {
      onConflict: "key",
      ignoreDuplicates: false,
    })
    .select("id,key");

  if (permissionsError || !permissions) {
    return json(request, { error: permissionsError?.message ?? "permissions_create_failed" }, 400);
  }

  const { error: rolePermissionsError } = await adminClient.from("role_permissions").upsert(
    permissions.map((permission) => ({
      role_id: adminRole.id,
      permission_id: permission.id,
    })),
    {
      onConflict: "role_id,permission_id",
      ignoreDuplicates: true,
    },
  );

  if (rolePermissionsError) {
    return json(request, { error: rolePermissionsError.message }, 400);
  }

  const { error: membershipError } = await adminClient.from("workspace_memberships").upsert({
    workspace_id: workspace.id,
    user_id: caller.user.id,
    role_id: adminRole.id,
    status: "active",
    accepted_at: now,
    updated_at: now,
  }, {
    onConflict: "workspace_id,user_id",
    ignoreDuplicates: false,
  });

  if (membershipError) {
    return json(request, { error: membershipError.message }, 400);
  }

  return json(request, { ok: true, workspaceId: workspace.id });
});
