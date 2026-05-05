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

export type SupabaseAssetSnapshotRecord = {
  [key: string]: boolean | number | string | null;
};

export type SupabaseAssetEventSnapshotRecord = {
  [key: string]: boolean | number | string | Record<string, unknown> | null;
};

export type SupabaseOutboxAssetSnapshot = {
  asset: SupabaseAssetSnapshotRecord;
  currentState: SupabaseAssetSnapshotRecord;
  event?: SupabaseAssetEventSnapshotRecord | null;
};

export type SupabaseOperationalSnapshotRecord = {
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  snapshot_json: Record<string, unknown>;
  updated_at: string;
  deleted_at?: string | null;
};

export type SupabaseOutboxTransportOptions = {
  supabaseUrl: string;
  anonKey: string;
  getAccessToken: () => Promise<string | null>;
  resolveAssetSnapshot?: (row: SupabaseOutboxTransportRow) => Promise<SupabaseOutboxAssetSnapshot | null> | SupabaseOutboxAssetSnapshot | null;
  resolveOperationalSnapshot?: (
    row: SupabaseOutboxTransportRow,
  ) => Promise<SupabaseOperationalSnapshotRecord | null> | SupabaseOperationalSnapshotRecord | null;
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

const upsertSupabaseRow = async ({
  accessToken,
  anonKey,
  endpoint,
  payload,
  fetchImpl,
}: {
  accessToken: string;
  anonKey: string;
  endpoint: string;
  payload: Record<string, unknown>;
  fetchImpl: typeof fetch;
}) => {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`Supabase outbox push failed (${response.status}): ${detail}`);
  }
};

export const createSupabaseOutboxTransport = ({
  supabaseUrl,
  anonKey,
  getAccessToken,
  resolveAssetSnapshot,
  resolveOperationalSnapshot,
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

    if (row.entity_type === "asset_event" && resolveAssetSnapshot) {
      const snapshot = await resolveAssetSnapshot(row);

      if (!snapshot) {
        throw new Error(`Supabase asset snapshot unavailable for outbox row ${row.id}.`);
      }

      await upsertSupabaseRow({
        accessToken,
        anonKey,
        endpoint: `${normalizedUrl}/rest/v1/assets?on_conflict=id`,
        payload: snapshot.asset,
        fetchImpl,
      });
      await upsertSupabaseRow({
        accessToken,
        anonKey,
        endpoint: `${normalizedUrl}/rest/v1/asset_current_state?on_conflict=asset_id`,
        payload: snapshot.currentState,
        fetchImpl,
      });

      if (snapshot.event) {
        await upsertSupabaseRow({
          accessToken,
          anonKey,
          endpoint: `${normalizedUrl}/rest/v1/asset_events?on_conflict=id`,
          payload: snapshot.event,
          fetchImpl,
        });
      }
    }

    if (["project", "packing_slip", "incident", "rma_case"].includes(row.entity_type) && resolveOperationalSnapshot) {
      const snapshot = await resolveOperationalSnapshot(row);

      if (!snapshot) {
        throw new Error(`Supabase operational snapshot unavailable for outbox row ${row.id}.`);
      }

      await upsertSupabaseRow({
        accessToken,
        anonKey,
        endpoint: `${normalizedUrl}/rest/v1/operational_snapshots?on_conflict=workspace_id,entity_type,entity_id`,
        payload: snapshot,
        fetchImpl,
      });
    }

    await upsertSupabaseRow({
      accessToken,
      anonKey,
      endpoint: `${normalizedUrl}/rest/v1/sync_outbox?on_conflict=id`,
      payload: {
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
      },
      fetchImpl,
    });
  };
};
