import type { AppRemoteCatalogRow, CatalogPullEntityType } from "@contracts";

type CatalogDependencyType = Extract<
  CatalogPullEntityType,
  "asset_categories" | "locations" | "clients" | "production_companies" | "crew_members" | "departments"
>;

export type CatalogDependencyMap = Partial<Record<CatalogDependencyType, Iterable<string | null | undefined>>>;

type CatalogDependencyRemote = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        in: (column: string, values: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
      };
    };
  };
};

type CatalogDependencyAppApi = {
  applyRemoteCatalogRows: (input: {
    workspaceId: string;
    entityType: CatalogPullEntityType;
    rows: AppRemoteCatalogRow[];
  }) => Promise<{ errors: string[] }>;
};

const MAX_IDS_PER_QUERY = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REMOTE_UUID_ENTITY_TYPES = new Set<CatalogDependencyType>([
  "asset_categories",
  "locations",
  "clients",
  "production_companies",
  "crew_members",
  "departments",
]);

const uniqueIds = (values: Iterable<string | null | undefined>): string[] =>
  Array.from(new Set(Array.from(values).filter((value): value is string => Boolean(value))));

const queryableRemoteIds = (entityType: CatalogDependencyType, ids: string[]) =>
  REMOTE_UUID_ENTITY_TYPES.has(entityType) ? ids.filter((id) => UUID_RE.test(id)) : ids;

const describeRemoteError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return String(error ?? "unknown remote error");
  }

  const record = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  return [
    typeof record.code === "string" ? record.code : null,
    typeof record.message === "string" ? record.message : null,
    typeof record.details === "string" ? record.details : null,
    typeof record.hint === "string" ? record.hint : null,
  ].filter(Boolean).join(" · ") || "unknown remote error";
};

const chunksOf = <T,>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

/**
 * Fetches exact catalog parents required by a snapshot before the snapshot is
 * applied. This is intentionally independent from delta cursors: a dependency
 * must remain recoverable even when an older cursor was advanced by a previous
 * app version or when concurrent pull hooks run out of order.
 */
export const hydrateCatalogDependencies = async (input: {
  remote: CatalogDependencyRemote;
  appApi: CatalogDependencyAppApi;
  workspaceId: string;
  dependencies: CatalogDependencyMap;
}): Promise<{ hydratedCount: number; errors: string[] }> => {
  let hydratedCount = 0;
  const errors: string[] = [];

  for (const [entityType, values] of Object.entries(input.dependencies) as Array<
    [CatalogDependencyType, Iterable<string | null | undefined> | undefined]
  >) {
    if (!values) continue;
    const ids = uniqueIds(values);
    const remoteIds = queryableRemoteIds(entityType, ids);
    for (const idsChunk of chunksOf(remoteIds, MAX_IDS_PER_QUERY)) {
      const { data, error } = await input.remote
        .from(entityType)
        .select("*")
        .eq("workspace_id", input.workspaceId)
        .in("id", idsChunk);
      if (error) {
        errors.push(`${entityType}: remote dependency query failed (${describeRemoteError(error)})`);
        continue;
      }

      const rows = (data ?? []) as AppRemoteCatalogRow[];
      if (!rows.length) continue;
      const result = await input.appApi.applyRemoteCatalogRows({
        workspaceId: input.workspaceId,
        entityType,
        rows,
      });
      hydratedCount += rows.length - result.errors.length;
      errors.push(...result.errors.map((message) => `${entityType}: ${message}`));
    }
  }

  return { hydratedCount, errors };
};

const records = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];

const idFrom = (row: Record<string, unknown> | undefined, key: string): string | null =>
  row && typeof row[key] === "string" && row[key] ? String(row[key]) : null;

export const catalogDependenciesFromOperationalSnapshots = (
  snapshots: Array<{ snapshot_json: Record<string, unknown> }>,
): CatalogDependencyMap => {
  const clients: Array<string | null> = [];
  const productionCompanies: Array<string | null> = [];
  const departments: Array<string | null> = [];

  for (const snapshot of snapshots) {
    const project = snapshot.snapshot_json.project as Record<string, unknown> | undefined;
    clients.push(idFrom(project, "client_id"));
    productionCompanies.push(idFrom(project, "production_company_id"));
    departments.push(
      ...records(snapshot.snapshot_json.projectDepartments).map((row) => idFrom(row, "department_id")),
      ...records(snapshot.snapshot_json.unitDepartments).map((row) => idFrom(row, "department_id")),
      // A crew assignment can reference a department outside the project/unit
      // matrices; hydrate those too so the assignment keeps its real department
      // instead of being nulled by the apply-side foreign-key guard.
      ...records(snapshot.snapshot_json.crewAssignments).map((row) => idFrom(row, "department_id")),
    );
  }

  return {
    clients,
    production_companies: productionCompanies,
    departments,
  };
};
