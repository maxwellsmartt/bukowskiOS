// Supabase keys workspaces by uuid. A non-UUID workspace id (e.g. the local
// offline fallback "workspace-metadata") cannot exist remotely, so any outbox
// row for it is local-only and must not be pushed — otherwise every push,
// including the sync_outbox mirror, fails with a uuid 400 and jams the queue.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isSyncableWorkspaceId = (value: string): boolean => UUID_RE.test(value);

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
  assignment?: SupabaseAssetSnapshotRecord | null;
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

export type SupabaseWorkspaceFileUpload = {
  metadata: Record<string, unknown>;
  objectKey: string;
  contentType: string;
  bytes: Uint8Array | null;
};

// A direct upsert of one or more rows into a real Supabase table. Used for
// domain entities (treasury, invoices, …) whose tables mirror the local
// SQLite schema 1:1, so the resolver can hand back ready-to-POST records.
export type SupabaseDomainUpsert = {
  table: string; // e.g. "bank_accounts"
  onConflict: string; // e.g. "id" or "transaction_id"
  rows: Array<Record<string, unknown>>;
  deleteBeforeInsert?: {
    column: string;
    value: string;
    workspaceScoped?: boolean;
  };
};

export type SupabaseOutboxTransportOptions = {
  supabaseUrl: string;
  anonKey: string;
  getAccessToken: () => Promise<string | null>;
  resolveAssetSnapshot?: (row: SupabaseOutboxTransportRow) => Promise<SupabaseOutboxAssetSnapshot | null> | SupabaseOutboxAssetSnapshot | null;
  resolveOperationalSnapshot?: (
    row: SupabaseOutboxTransportRow,
  ) => Promise<SupabaseOperationalSnapshotRecord | null> | SupabaseOperationalSnapshotRecord | null;
  resolveWorkspaceFileUpload?: (
    row: SupabaseOutboxTransportRow,
  ) => Promise<SupabaseWorkspaceFileUpload | null> | SupabaseWorkspaceFileUpload | null;
  // Materializes a financial-domain outbox row into its real Supabase table(s).
  // Returns null for entity types it doesn't handle (so other resolvers run).
  resolveDomainUpserts?: (
    row: SupabaseOutboxTransportRow,
  ) => Promise<SupabaseDomainUpsert[] | null> | SupabaseDomainUpsert[] | null;
  // For a delete-operation outbox row, returns the Supabase rows to remove so a
  // local deletion propagates to the cloud (and won't be left as an orphan).
  // Order matters: list children before parents when FKs don't cascade.
  resolveDomainDeletes?: (
    row: SupabaseOutboxTransportRow,
  ) => Promise<SupabaseDomainDelete[] | null> | SupabaseDomainDelete[] | null;
  fetchImpl?: typeof fetch;
};

export type SupabaseDomainDelete = {
  table: string;
  filters: [
    { column: string; value: string },
    ...Array<{ column: string; value: string }>,
  ];
  workspaceScoped?: boolean;
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

const updateSupabaseRows = async ({
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
    method: "PATCH",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`Supabase domain update failed (${response.status}): ${detail}`);
  }
};

const deleteSupabaseRows = async ({
  accessToken,
  anonKey,
  endpoint,
  fetchImpl,
}: {
  accessToken: string;
  anonKey: string;
  endpoint: string;
  fetchImpl: typeof fetch;
}) => {
  const response = await fetchImpl(endpoint, {
    method: "DELETE",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=minimal",
    },
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`Supabase domain delete failed (${response.status}): ${detail}`);
  }
};

const storageObjectEndpoint = (normalizedUrl: string, objectKey: string) =>
  `${normalizedUrl}/storage/v1/object/workspace-documents/${objectKey.split("/").map(encodeURIComponent).join("/")}`;

const uploadStorageObject = async (input: {
  normalizedUrl: string;
  accessToken: string;
  anonKey: string;
  objectKey: string;
  contentType: string;
  bytes: Uint8Array;
  fetchImpl: typeof fetch;
}) => {
  const response = await input.fetchImpl(storageObjectEndpoint(input.normalizedUrl, input.objectKey), {
    method: "POST",
    headers: {
      apikey: input.anonKey,
      Authorization: `Bearer ${input.accessToken}`,
      "content-type": input.contentType || "application/octet-stream",
      "x-upsert": "true",
      "cache-control": "3600",
    },
    body: input.bytes as BodyInit,
  });
  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`Supabase workspace file upload failed (${response.status}): ${detail}`);
  }
};

const deleteStorageObject = async (input: {
  normalizedUrl: string;
  accessToken: string;
  anonKey: string;
  objectKey: string;
  fetchImpl: typeof fetch;
}) => {
  const response = await input.fetchImpl(storageObjectEndpoint(input.normalizedUrl, input.objectKey), {
    method: "DELETE",
    headers: {
      apikey: input.anonKey,
      Authorization: `Bearer ${input.accessToken}`,
    },
  });
  if (!response.ok && response.status !== 404) {
    const detail = await readErrorBody(response);
    throw new Error(`Supabase workspace file delete failed (${response.status}): ${detail}`);
  }
};

const isTransactionLinkDedupeConflict = (error: unknown) =>
  error instanceof Error &&
  /409/.test(error.message) &&
  /idx_txn_links_dedupe_v4|duplicate key value violates unique constraint/i.test(error.message);

const requireFilterValue = (record: Record<string, unknown>, column: string) => {
  const value = record[column];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Transaction link dedupe recovery cannot run without ${column}.`);
  }
  return value;
};

const filterParam = (column: string, value: unknown) => {
  const encodedColumn = encodeURIComponent(column);
  if (value === null || value === undefined || value === "") return `${encodedColumn}=is.null`;
  return `${encodedColumn}=eq.${encodeURIComponent(String(value))}`;
};

const scopedDeleteEndpoint = (
  normalizedUrl: string,
  table: string,
  filters: Array<{ column: string; value: string }>,
  workspaceId: string,
  options: { workspaceScoped?: boolean } = {},
) => {
  const workspaceScoped = options.workspaceScoped !== false;
  const normalizedTable = table.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(normalizedTable)) {
    throw new Error(`Supabase delete target table is invalid: ${table}.`);
  }
  if (!filters.length) {
    throw new Error(`Supabase delete filters cannot be empty for table ${table}.`);
  }
  if (workspaceScoped && !workspaceId.trim()) {
    throw new Error(`Supabase delete workspace_id cannot be empty for table ${table}.`);
  }

  const validatedFilters = filters.map(({ column, value }) => {
    const normalizedColumn = column.trim();
    if (!/^[a-z_][a-z0-9_]*$/.test(normalizedColumn)) {
      throw new Error(`Supabase delete filter column is invalid for table ${table}.`);
    }
    if (normalizedColumn === "workspace_id") {
      throw new Error(`Supabase delete filters cannot provide workspace_id for table ${table}.`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Supabase delete filter value cannot be empty for ${table}.${normalizedColumn}.`);
    }
    return { column: normalizedColumn, value };
  });

  const queryFilters = workspaceScoped
    ? [...validatedFilters, { column: "workspace_id", value: workspaceId }]
    : validatedFilters;
  const query = queryFilters
    .map(({ column, value }) => filterParam(column, value))
    .join("&");
  return `${normalizedUrl}/rest/v1/${normalizedTable}?${query}`;
};

const transactionLinkDedupeEndpoint = (normalizedUrl: string, record: Record<string, unknown>) => {
  const filters = [
    filterParam("workspace_id", requireFilterValue(record, "workspace_id")),
    filterParam("linked_entity_type", requireFilterValue(record, "linked_entity_type")),
    filterParam("linked_entity_id", requireFilterValue(record, "linked_entity_id")),
    filterParam("transaction_id", record.transaction_id),
    filterParam("payment_instrument_id", record.payment_instrument_id),
  ];
  return `${normalizedUrl}/rest/v1/transaction_links?${filters.join("&")}`;
};

export const createSupabaseOutboxTransport = ({
  supabaseUrl,
  anonKey,
  getAccessToken,
  resolveAssetSnapshot,
  resolveOperationalSnapshot,
  resolveWorkspaceFileUpload,
  resolveDomainUpserts,
  resolveDomainDeletes,
  fetchImpl = fetch,
}: SupabaseOutboxTransportOptions) => {
  const normalizedUrl = normalizeUrl(supabaseUrl);

  const recordOutboxRow = async (row: SupabaseOutboxTransportRow, accessToken: string, payload: unknown) => {
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

  return async (row: SupabaseOutboxTransportRow) => {
    // Local-only workspace (non-UUID id): nothing to sync remotely. Resolve so
    // the worker marks the row sent and it leaves the queue cleanly.
    if (!isSyncableWorkspaceId(row.workspace_id)) {
      return;
    }

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

    if (row.entity_type === "workspace_file") {
      const file = resolveWorkspaceFileUpload ? await resolveWorkspaceFileUpload(row) : null;
      if (!file) throw new Error(`Workspace file unavailable for outbox row ${row.id}.`);

      if (row.operation_type === "delete") {
        await deleteStorageObject({ normalizedUrl, accessToken, anonKey, objectKey: file.objectKey, fetchImpl });
      } else {
        if (!file.bytes) throw new Error(`Workspace file bytes unavailable for outbox row ${row.id}.`);
        await uploadStorageObject({
          normalizedUrl,
          accessToken,
          anonKey,
          objectKey: file.objectKey,
          contentType: file.contentType,
          bytes: file.bytes,
          fetchImpl,
        });
      }

      await upsertSupabaseRow({
        accessToken,
        anonKey,
        endpoint: `${normalizedUrl}/rest/v1/workspace_files?on_conflict=id`,
        payload: file.metadata,
        fetchImpl,
      });
      await recordOutboxRow(row, accessToken, payload);
      return;
    }

    // Delete-propagation: a local deletion removes the matching cloud rows so a
    // second machine's pull won't resurrect them. We skip the upsert resolvers.
    if (row.operation_type === "delete") {
      if (["project", "packing_slip", "incident", "rma_case"].includes(row.entity_type)) {
        const snapshot = resolveOperationalSnapshot ? await resolveOperationalSnapshot(row) : null;
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
        await recordOutboxRow(row, accessToken, payload);
        return;
      }

      const deletes = resolveDomainDeletes ? (await resolveDomainDeletes(row)) ?? [] : [];
      if (!deletes.length) {
        throw new Error(`Supabase delete targets unavailable for outbox row ${row.id}.`);
      }
      const endpoints = deletes.map((target) =>
        scopedDeleteEndpoint(normalizedUrl, target.table, target.filters, row.workspace_id, {
          workspaceScoped: target.workspaceScoped,
        }),
      );
      for (const endpoint of endpoints) {
        await deleteSupabaseRows({
          accessToken,
          anonKey,
          endpoint,
          fetchImpl,
        });
      }
      await recordOutboxRow(row, accessToken, payload);
      return;
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
      if (snapshot.assignment) {
        await upsertSupabaseRow({
          accessToken,
          anonKey,
          endpoint: `${normalizedUrl}/rest/v1/asset_assignments?on_conflict=id`,
          payload: snapshot.assignment,
          fetchImpl,
        });
      }
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

    if (resolveDomainUpserts) {
      const domainUpserts = await resolveDomainUpserts(row);
      if (domainUpserts) {
        for (const upsert of domainUpserts) {
          if (upsert.deleteBeforeInsert) {
            const { column, value, workspaceScoped } = upsert.deleteBeforeInsert;
            await deleteSupabaseRows({
              accessToken,
              anonKey,
              endpoint: scopedDeleteEndpoint(
                normalizedUrl,
                upsert.table,
                [{ column, value }],
                row.workspace_id,
                { workspaceScoped },
              ),
              fetchImpl,
            });
          }
          for (const record of upsert.rows) {
            try {
              await upsertSupabaseRow({
                accessToken,
                anonKey,
                endpoint: `${normalizedUrl}/rest/v1/${upsert.table}?on_conflict=${upsert.onConflict}`,
                payload: record,
                fetchImpl,
              });
            } catch (error) {
              if (upsert.table !== "transaction_links" || !isTransactionLinkDedupeConflict(error)) {
                throw error;
              }
              await updateSupabaseRows({
                accessToken,
                anonKey,
                endpoint: transactionLinkDedupeEndpoint(normalizedUrl, record),
                payload: record,
                fetchImpl,
              });
            }
          }
        }
      }
    }

    await recordOutboxRow(row, accessToken, payload);
  };
};
