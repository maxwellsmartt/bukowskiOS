import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.2";

type SendInvitePayload = {
  workspaceId: string;
  email: string;
  roleId: string;
  message?: string;
};

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type SupabaseAuthListUsersPage = {
  users?: SupabaseAuthUser[];
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

const normalizeEmail = (email: unknown) => (typeof email === "string" ? email.trim().toLowerCase() : "");

const findAuthUserByEmail = async (adminClient: ReturnType<typeof createClient>, email: string) => {
  const targetEmail = normalizeEmail(email);

  if (!targetEmail) {
    return null;
  }

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) {
      throw error;
    }

    const users = ((data as SupabaseAuthListUsersPage | null)?.users ?? []) as SupabaseAuthUser[];
    const match = users.find((user) => normalizeEmail(user.email) === targetEmail);

    if (match) {
      return match;
    }

    if (users.length < 100) {
      return null;
    }
  }

  return null;
};

const upsertUserProfile = async (adminClient: ReturnType<typeof createClient>, user: SupabaseAuthUser, fallbackEmail: string) => {
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : null;

  await adminClient.from("user_profiles").upsert(
    {
      user_id: user.id,
      email: normalizeEmail(user.email) || normalizeEmail(fallbackEmail),
      full_name: fullName,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id",
      ignoreDuplicates: false,
    },
  );
};

const sendExistingUserMagicLink = async (supabaseUrl: string, anonKey: string, email: string) => {
  const publicClient = createClient(supabaseUrl, anonKey);
  const { error } = await publicClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: "bukowskios://auth/callback?flow=first-login",
      shouldCreateUser: false,
    },
  });

  if (error) {
    return error.message;
  }

  return null;
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
  const normalizedEmail = normalizeEmail(payload.email);

  if (!normalizedEmail) {
    return json(request, { error: "email_required" }, 400);
  }

  let inviteUser: SupabaseAuthUser | null = null;
  const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo: `bukowskios://auth/accept-invite?flow=invite&workspace_id=${encodeURIComponent(payload.workspaceId)}`,
    data: {
      workspace_id: payload.workspaceId,
      role_id: payload.roleId,
      message: payload.message ?? null,
    },
  });

  if (inviteError || !invite.user) {
    const existingUser = await findAuthUserByEmail(adminClient, normalizedEmail);

    if (!existingUser) {
      return json(request, { error: inviteError?.message ?? "invite_failed" }, 400);
    }

    inviteUser = existingUser;
  } else {
    inviteUser = invite.user;
  }

  await upsertUserProfile(adminClient, inviteUser, normalizedEmail);

  const now = new Date().toISOString();
  const isExistingUser = Boolean(inviteError);

  const { error: membershipError } = await adminClient.from("workspace_memberships").upsert({
    workspace_id: payload.workspaceId,
    user_id: inviteUser.id,
    role_id: payload.roleId,
    status: isExistingUser ? "active" : "invited",
    invited_by: caller.user?.id ?? null,
    invited_at: isExistingUser ? null : now,
    accepted_at: isExistingUser ? now : null,
    updated_at: now,
  }, {
    onConflict: "workspace_id,user_id",
    ignoreDuplicates: false,
  });

  if (membershipError) {
    return json(request, { error: membershipError.message }, 400);
  }

  const magicLinkError = isExistingUser ? await sendExistingUserMagicLink(supabaseUrl, anonKey, normalizedEmail) : null;

  if (magicLinkError) {
    return json(request, {
      ok: true,
      userId: inviteUser.id,
      alreadyRegistered: true,
      membershipStatus: "active",
      magicLinkSent: false,
      warning: magicLinkError,
    });
  }

  return json(request, {
    ok: true,
    userId: inviteUser.id,
    alreadyRegistered: isExistingUser,
    membershipStatus: isExistingUser ? "active" : "invited",
    magicLinkSent: true,
  });
});
