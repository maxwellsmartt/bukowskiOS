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

const operationalPermissions = [
  { key: "projects.read", label: "Read projects", description: "View project registry, details and schedule" },
  { key: "projects.manage", label: "Manage projects", description: "Create, edit and archive projects" },
  { key: "assets.read", label: "Read assets", description: "View asset registry and current state" },
  { key: "assets.manage", label: "Manage assets", description: "Create movements and update assets" },
  { key: "incidents.read", label: "Read incidents", description: "View incident queues and details" },
  { key: "incidents.create", label: "Create incidents", description: "Report, update and resolve incidents" },
  { key: "packing-slips.read", label: "Read packing slips", description: "View packing slip detail and status" },
  { key: "packing-slips.create", label: "Create packing slips", description: "Issue and return packing slips" },
  { key: "finance.read", label: "Read finance", description: "View finance exposure and entries" },
  { key: "invoices.read", label: "Read invoices", description: "View workspace invoices." },
  { key: "invoices.create", label: "Create invoices", description: "Create new invoice drafts." },
  { key: "invoices.edit_draft", label: "Edit invoice drafts", description: "Edit invoices that are still in draft." },
  { key: "invoices.issue", label: "Issue invoices", description: "Issue invoices and consume the workspace NCF sequence." },
  { key: "invoices.cancel", label: "Cancel invoices", description: "Cancel invoices before payment." },
  { key: "invoices.record_payment", label: "Record invoice payments", description: "Register payments against invoices." },
  { key: "invoices.export", label: "Export invoices", description: "Generate invoice PDFs." },
  { key: "currency.manage_rates", label: "Manage exchange rates", description: "Create and edit currency settings and exchange rates." },
  { key: "quotes.read", label: "Read quotes", description: "View workspace quotes." },
  { key: "quotes.create", label: "Create quotes", description: "Create new quotes." },
  { key: "quotes.edit", label: "Edit quotes", description: "Edit drafts and send quotes." },
  { key: "quotes.approve", label: "Approve quotes", description: "Approve or reject quotes." },
  { key: "quotes.cancel", label: "Cancel quotes", description: "Cancel or delete quotes." },
  { key: "quotes.export", label: "Export quotes", description: "Generate PDFs of quotes." },
  { key: "quotes.manage_templates", label: "Manage quote templates", description: "Create and edit quote templates." },
  { key: "rma.read", label: "Read RMAs", description: "Review RMA queues and manufacturer cases" },
  { key: "rma.create", label: "Create RMAs", description: "Open or prepare new RMA cases" },
  { key: "users.invite", label: "Invite users", description: "Invite a teammate to join a workspace by email." },
];

const operationalRoles = [
  {
    key: "admin",
    name: "Admin",
    description: "Full access to settings, team, assets, projects and finance.",
    isSystemRole: true,
    permissionKeys: operationalPermissions.map((permission) => permission.key),
  },
  {
    key: "crew",
    name: "Crew",
    description: "Daily crew access for assigned gear, packing context and incident reports.",
    isSystemRole: false,
    permissionKeys: ["projects.read", "assets.read", "incidents.read", "incidents.create", "packing-slips.read"],
  },
  {
    key: "supervisor",
    name: "Supervisor",
    description: "Coordinate projects, assets, incidents, RMAs and packing slips.",
    isSystemRole: false,
    permissionKeys: [
      "projects.read",
      "projects.manage",
      "assets.read",
      "assets.manage",
      "incidents.read",
      "incidents.create",
      "packing-slips.read",
      "packing-slips.create",
      "rma.read",
      "rma.create",
    ],
  },
  {
    key: "finance_viewer",
    name: "Finance Viewer",
    description: "Review finance status without edit access.",
    isSystemRole: false,
    permissionKeys: ["finance.read", "quotes.read", "quotes.export", "invoices.read", "invoices.export"],
  },
  {
    key: "maintenance",
    name: "Maintenance",
    description: "Handle incidents, repairs and RMA follow-up.",
    isSystemRole: false,
    permissionKeys: ["assets.read", "incidents.read", "incidents.create", "rma.read", "rma.create"],
  },
];

const systemActorPermissionKeys = [
  "projects.read",
  "projects.manage",
  "assets.read",
  "assets.manage",
  "incidents.read",
  "incidents.create",
  "packing-slips.read",
  "packing-slips.create",
  "finance.read",
  "invoices.read",
  "invoices.create",
  "invoices.edit_draft",
  "invoices.issue",
  "invoices.cancel",
  "invoices.record_payment",
  "invoices.export",
  "rma.read",
  "rma.create",
  "quotes.read",
  "quotes.create",
  "quotes.edit",
  "quotes.export",
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

  const { data: roles, error: roleError } = await adminClient
    .from("roles")
    .upsert(
      operationalRoles.map((role) => ({
        workspace_id: workspace.id,
        key: role.key,
        name: role.name,
        description: role.description,
        is_system_role: role.isSystemRole,
        updated_at: now,
      })),
      {
        onConflict: "workspace_id,key",
        ignoreDuplicates: false,
      },
    )
    .select("id,key");

  if (roleError || !roles) {
    return json(request, { error: roleError?.message ?? "role_create_failed" }, 400);
  }

  const { data: permissions, error: permissionsError } = await adminClient
    .from("permissions")
    .upsert(operationalPermissions, {
      onConflict: "key",
      ignoreDuplicates: false,
    })
    .select("id,key");

  if (permissionsError || !permissions) {
    return json(request, { error: permissionsError?.message ?? "permissions_create_failed" }, 400);
  }

  const permissionByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));
  const roleByKey = new Map(((roles ?? []) as Array<{ id: string; key: string }>).map((role) => [role.key, role.id]));
  const rolePermissionRows = operationalRoles.flatMap((role) => {
    const roleId = roleByKey.get(role.key);

    if (!roleId) {
      return [];
    }

    return role.permissionKeys
      .map((permissionKey) => {
        const permissionId = permissionByKey.get(permissionKey);
        return permissionId ? { role_id: roleId, permission_id: permissionId } : null;
      })
      .filter((row): row is { role_id: string; permission_id: string } => Boolean(row));
  });

  const { error: rolePermissionsError } = await adminClient.from("role_permissions").upsert(
    rolePermissionRows,
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
    role_id: roleByKey.get("admin") ?? null,
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

  const { data: systemActor, error: systemActorError } = await adminClient
    .from("workspace_system_actors")
    .upsert(
      {
        workspace_id: workspace.id,
        key: "ai_agent",
        name: "AI Agent",
        email: "ai-agent@bukowskios.local",
        kind: "agent",
        description: "System actor used to audit assistant-driven operational actions in this workspace.",
        status: "active",
        metadata_json: {
          local_actor_id: "user-ops",
          managed_by: "bukowskiOS",
        },
        updated_at: now,
      },
      {
        onConflict: "workspace_id,key",
        ignoreDuplicates: false,
      },
    )
    .select("id")
    .single();

  if (systemActorError || !systemActor) {
    return json(request, { error: systemActorError?.message ?? "system_actor_create_failed" }, 400);
  }

  const systemActorPermissionRows = systemActorPermissionKeys
    .map((permissionKey) => {
      const permissionId = permissionByKey.get(permissionKey);
      return permissionId ? { actor_id: systemActor.id, permission_id: permissionId } : null;
    })
    .filter((row): row is { actor_id: string; permission_id: string } => Boolean(row));

  if (systemActorPermissionRows.length > 0) {
    const { error: systemActorPermissionsError } = await adminClient
      .from("workspace_system_actor_permissions")
      .upsert(systemActorPermissionRows, {
        onConflict: "actor_id,permission_id",
        ignoreDuplicates: true,
      });

    if (systemActorPermissionsError) {
      return json(request, { error: systemActorPermissionsError.message }, 400);
    }
  }

  const baseCategories = [
    { code: "CAM", name: "Cameras", description: "Bodies, accessories and rigs." },
    { code: "LENS", name: "Lenses", description: "Primes, zooms and matte boxes." },
    { code: "LITE", name: "Lighting", description: "Fixtures, modifiers and stands." },
    { code: "GRIP", name: "Grip", description: "Stands, clamps, dollies and hardware." },
    { code: "SOUND", name: "Sound", description: "Mics, recorders, mixers and cables." },
  ];

  await adminClient.from("asset_categories").upsert(
    baseCategories.map((category) => ({
      workspace_id: workspace.id,
      code: category.code,
      name: category.name,
      description: category.description,
      updated_at: now,
    })),
    { onConflict: "workspace_id,code", ignoreDuplicates: true },
  );

  await adminClient.from("locations").upsert(
    [
      {
        workspace_id: workspace.id,
        code: "WH-01",
        name: "Main warehouse",
        type: "warehouse",
        description: "Default storage location. Rename or expand from the Catalog screen.",
        updated_at: now,
      },
    ],
    { onConflict: "workspace_id,code", ignoreDuplicates: true },
  );

  return json(request, { ok: true, workspaceId: workspace.id });
});
