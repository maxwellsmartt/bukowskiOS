import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.2";

type BootstrapPayload = {
  name: string;
  slug: string;
  baseCurrency?: string;
  iconColor?: string;
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
  const { data: caller, error: callerError } = await userClient.auth.getUser();

  if (callerError || !caller.user) {
    return json({ error: "authentication_required" }, 401);
  }

  const payload = (await request.json()) as BootstrapPayload;
  const now = new Date().toISOString();
  const { data: workspace, error: workspaceError } = await adminClient
    .from("workspaces")
    .insert({
      name: payload.name,
      slug: payload.slug,
      base_currency: payload.baseCurrency ?? "USD",
      icon_color: payload.iconColor ?? null,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (workspaceError || !workspace) {
    return json({ error: workspaceError?.message ?? "workspace_create_failed" }, 400);
  }

  const { data: adminRole, error: roleError } = await adminClient
    .from("roles")
    .insert({
      workspace_id: workspace.id,
      key: "admin",
      name: "Admin",
      description: "System admin role. Clone to customize.",
      is_system_role: true,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (roleError || !adminRole) {
    return json({ error: roleError?.message ?? "role_create_failed" }, 400);
  }

  const { error: membershipError } = await adminClient.from("workspace_memberships").insert({
    workspace_id: workspace.id,
    user_id: caller.user.id,
    role_id: adminRole.id,
    status: "active",
    accepted_at: now,
    created_at: now,
    updated_at: now,
  });

  if (membershipError) {
    return json({ error: membershipError.message }, 400);
  }

  return json({ ok: true, workspaceId: workspace.id });
});
