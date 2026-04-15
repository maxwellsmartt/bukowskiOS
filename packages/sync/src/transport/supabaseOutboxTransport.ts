export type SupabaseOutboxTransportRow = {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  event_id: string | null;
  operation_type: string;
  payload_json: string;
  attempt_count: number;
  created_at: string;
  updated_at: string;
};

export type SupabaseOutboxTransportOptions = {
  supabaseUrl: string;
  anonKey: string;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, "");

const readErrorBody = async (response: Response) => {
  try {
    const payload = (await response.json()) as { message?: unknown; error?: unknown; details?: unknown };
    return [payload.message, payload.error, payload.details].filter((value): value is string => typeof value === "string").join(" ");
  } catch {
    return response.statusText;
  }
};

export const createSupabaseOutboxTransport = ({
  supabaseUrl,
  anonKey,
  getAccessToken,
  fetchImpl = fetch,
}: SupabaseOutboxTransportOptions) => {
  const normalizedUrl = normalizeUrl(supabaseUrl);

  return async (row: SupabaseOutboxTransportRow) => {
    const accessToken = await getAccessToken();

    if (!normalizedUrl || !anonKey.trim()) {
      throw new Error("Supabase sync is enabled but VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing.");
    }

    if (!accessToken) {
      throw new Error("Supabase sync is enabled but no stored user session is available.");
    }

    const payload = JSON.parse(row.payload_json) as unknown;

    if (payload === null || typeof payload !== "object") {
      throw new Error("Outbox payload must be a JSON object.");
    }

    const response = await fetchImpl(`${normalizedUrl}/rest/v1/sync_outbox?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: row.id,
        workspace_id: row.workspace_id,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        event_id: row.event_id,
        operation_type: row.operation_type,
        payload_json: payload,
        status: "sent",
        attempt_count: row.attempt_count,
        last_error: null,
        next_retry_at: null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }),
    });

    if (!response.ok) {
      const detail = await readErrorBody(response);
      throw new Error(`Supabase outbox push failed (${response.status}): ${detail}`);
    }
  };
};
