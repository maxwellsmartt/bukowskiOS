import type { DatabaseSync } from "node:sqlite";

import type {
  AssetDuplicateAuditConfidence,
  AssetDuplicateAuditGroup,
  AssetDuplicateAuditItem,
  AssetDuplicateAuditPreview,
  AssetDuplicateAuditStrategy,
} from "@contracts";

type DuplicateAuditAssetRow = {
  id: string;
  workspace_id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  internal_code: string;
  qr_code_value: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  current_location_id: string | null;
  current_location_name: string | null;
  current_project_id: string | null;
  current_project_name: string | null;
  current_project_status: string | null;
  custody_status: string;
  total_quantity: number;
  available_quantity: number;
  assigned_quantity: number;
  checked_out_quantity: number;
  open_incident_count: number;
  file_count: number;
};

type CandidateBucket = {
  key: string;
  reason: string;
  confidence: AssetDuplicateAuditConfidence;
  assetIds: Set<string>;
};

const normalizeLookup = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

const cleanValue = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "—" || trimmed.toLowerCase() === "sin serie") return "";
  return trimmed;
};

const stripGeneratedSuffix = (code: string) => {
  const normalized = code.trim();
  const match = normalized.match(/^(.+)-(\d{1,4})$/);
  if (!match) return normalized;
  return match[1];
};

const extractSourceCodes = (notes: string | null | undefined) => {
  const source = notes ?? "";
  const codes = new Set<string>();
  const patterns = [
    /deconflicted code from\s+([A-Z0-9._-]+)\s+to/gi,
    /Original CSV code repeated:\s*([^.\n;]+)/gi,
    /Código Rentman original:\s*([^;\n]+)/gi,
    /Codigo Rentman original:\s*([^;\n]+)/gi,
    /Source QR\/barcode preserved[^:]*:\s*([^;\n]+)/gi,
  ];

  patterns.forEach((pattern) => {
    let match = pattern.exec(source);
    while (match) {
      const normalized = cleanValue(match[1]);
      if (normalized) codes.add(normalized);
      match = pattern.exec(source);
    }
  });

  return [...codes];
};

const explainBlockers = (row: DuplicateAuditAssetRow) => {
  const blockers: string[] = [];
  if (row.current_project_id && row.current_project_status !== "Wrapped") {
    blockers.push(`Está asignado a ${row.current_project_name ?? "un proyecto activo"} (${row.current_project_status ?? "activo"}).`);
  }
  if (row.assigned_quantity > 0 || row.checked_out_quantity > 0 || row.custody_status !== "available") {
    blockers.push("Tiene unidades asignadas, reservadas o fuera de almacén.");
  }
  if (row.open_incident_count > 0) {
    blockers.push("Tiene incidentes abiertos.");
  }
  return blockers;
};

const chooseCanonical = (rows: DuplicateAuditAssetRow[]) =>
  [...rows].sort((left, right) => {
    const leftStem = stripGeneratedSuffix(left.internal_code);
    const rightStem = stripGeneratedSuffix(right.internal_code);
    const leftIsBase = leftStem === left.internal_code ? 0 : 1;
    const rightIsBase = rightStem === right.internal_code ? 0 : 1;
    if (leftIsBase !== rightIsBase) return leftIsBase - rightIsBase;
    const created = left.created_at.localeCompare(right.created_at);
    if (created !== 0) return created;
    if (right.total_quantity !== left.total_quantity) return right.total_quantity - left.total_quantity;
    return left.id.localeCompare(right.id);
  })[0];

const buildGroupId = (assetIds: string[]) => `duplicate-${assetIds.slice().sort().join("-").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 160)}`;

const toAuditItem = (row: DuplicateAuditAssetRow, canonicalId: string, blockers: string[]): AssetDuplicateAuditItem => ({
  id: row.id,
  code: row.internal_code,
  name: row.name,
  category: row.category_name ?? "Sin categoría",
  location: row.current_location_name ?? "Sin ubicación",
  project: row.current_project_name ?? "—",
  projectStatus: row.current_project_status,
  serialNumber: cleanValue(row.serial_number) || "—",
  qrCode: cleanValue(row.qr_code_value) || "—",
  totalQuantity: row.total_quantity,
  availableQuantity: row.available_quantity,
  assignedQuantity: row.assigned_quantity,
  checkedOutQuantity: row.checked_out_quantity,
  custody: row.custody_status,
  incidentsOpen: row.open_incident_count,
  fileCount: row.file_count,
  createdAt: row.created_at,
  role: row.id === canonicalId ? "canonical" : blockers.length ? "review" : "duplicate",
  blockers,
});

const confidenceRank = (confidence: AssetDuplicateAuditConfidence) => {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
};

export const buildAssetDuplicateAuditPreview = (db: DatabaseSync, workspaceId?: string): AssetDuplicateAuditPreview => {
  const rows = db
    .prepare(
      `
        SELECT
          assets.id,
          assets.workspace_id,
          assets.category_id,
          asset_categories.name AS category_name,
          assets.name,
          assets.brand,
          assets.model,
          assets.serial_number,
          assets.internal_code,
          assets.qr_code_value,
          assets.notes,
          assets.created_at,
          assets.updated_at,
          asset_current_state.current_location_id,
          locations.name AS current_location_name,
          asset_current_state.current_project_id,
          projects.name AS current_project_name,
          projects.status AS current_project_status,
          COALESCE(asset_current_state.custody_status, 'available') AS custody_status,
          COALESCE(asset_current_state.total_quantity, 1) AS total_quantity,
          COALESCE(asset_current_state.available_quantity, 1) AS available_quantity,
          COALESCE(asset_current_state.assigned_quantity, 0) AS assigned_quantity,
          COALESCE(asset_current_state.checked_out_quantity, 0) AS checked_out_quantity,
          (
            SELECT COUNT(*)
            FROM incidents
            WHERE incidents.asset_id = assets.id
              AND incidents.status IN ('Open', 'In review')
          ) AS open_incident_count,
          (
            SELECT COUNT(*)
            FROM asset_files
            WHERE asset_files.asset_id = assets.id
              AND COALESCE(asset_files.status, 'available') != 'deleted'
          ) AS file_count
        FROM assets
        LEFT JOIN asset_current_state ON asset_current_state.asset_id = assets.id
        LEFT JOIN asset_categories ON asset_categories.id = assets.category_id
        LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
        LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
        WHERE assets.is_active = 1
          AND (? IS NULL OR assets.workspace_id = ?)
        ORDER BY assets.created_at ASC, assets.id ASC
      `,
    )
    .all(workspaceId ?? null, workspaceId ?? null) as DuplicateAuditAssetRow[];

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const buckets = new Map<string, CandidateBucket>();

  const addBucket = (
    key: string,
    reason: string,
    confidence: AssetDuplicateAuditConfidence,
    row: DuplicateAuditAssetRow,
  ) => {
    const normalizedKey = normalizeLookup(key);
    if (!normalizedKey) return;
    const bucketKey = `${reason}:${normalizedKey}`;
    const current =
      buckets.get(bucketKey) ??
      ({
        key: bucketKey,
        reason,
        confidence,
        assetIds: new Set<string>(),
      } satisfies CandidateBucket);
    current.assetIds.add(row.id);
    buckets.set(bucketKey, current);
  };

  rows.forEach((row) => {
    const serial = cleanValue(row.serial_number);
    if (serial.length >= 3) addBucket(serial, "Misma serie", "high", row);

    const qrCode = cleanValue(row.qr_code_value);
    if (qrCode.length >= 3) addBucket(qrCode, "Mismo QR/barcode", "high", row);

    extractSourceCodes(row.notes).forEach((sourceCode) => addBucket(sourceCode, "Mismo código de origen importado", "high", row));

    const codeStem = stripGeneratedSuffix(row.internal_code);
    if (codeStem !== row.internal_code && codeStem.length >= 3) {
      addBucket(codeStem, "Código base con sufijos generados", "medium", row);
    }

    if (!serial && !qrCode) {
      const fingerprint = [
        row.name,
        row.category_id ?? row.category_name ?? "",
        row.brand ?? "",
        row.model ?? "",
        row.current_location_id ?? "",
      ].map(normalizeLookup).join("|");
      if (fingerprint.replace(/\|/g, "").length >= 6) {
        addBucket(fingerprint, "Misma huella operativa sin serie", "review", row);
      }
    }
  });

  const merged = new Map<string, { assetIds: string[]; reasons: Set<string>; confidence: AssetDuplicateAuditConfidence }>();
  [...buckets.values()]
    .filter((bucket) => bucket.assetIds.size > 1)
    .forEach((bucket) => {
      const assetIds = [...bucket.assetIds].sort();
      const mergeKey = assetIds.join("|");
      const current =
        merged.get(mergeKey) ??
        ({
          assetIds,
          reasons: new Set<string>(),
          confidence: "review" as AssetDuplicateAuditConfidence,
        });
      current.reasons.add(bucket.reason);
      if (confidenceRank(bucket.confidence) > confidenceRank(current.confidence)) {
        current.confidence = bucket.confidence;
      }
      merged.set(mergeKey, current);
    });

  const groups = [...merged.values()]
    .map((candidate): AssetDuplicateAuditGroup | null => {
      const groupRows = candidate.assetIds.map((assetId) => rowsById.get(assetId)).filter(Boolean) as DuplicateAuditAssetRow[];
      if (groupRows.length < 2) return null;

      const canonical = chooseCanonical(groupRows);
      const duplicateRows = groupRows.filter((row) => row.id !== canonical.id);
      const blockerMap = new Map(duplicateRows.map((row) => [row.id, explainBlockers(row)] as const));
      const blockers = duplicateRows.flatMap((row) => blockerMap.get(row.id)?.map((blocker) => `${row.internal_code}: ${blocker}`) ?? []);
      const hasIdentityReason = candidate.reasons.has("Misma serie") || candidate.reasons.has("Mismo QR/barcode");
      const hasReviewOnlyReason = candidate.confidence === "review";
      const totalQuantityAfter = groupRows.reduce((total, row) => total + row.total_quantity, 0);

      let strategy: AssetDuplicateAuditStrategy = "review";
      let confidence = candidate.confidence;
      if (!blockers.length && !hasReviewOnlyReason && hasIdentityReason) {
        strategy = "archive_duplicates";
        confidence = "high";
      } else if (!blockers.length && !hasReviewOnlyReason) {
        strategy = "reconcile_quantity";
        confidence = candidate.confidence === "high" ? "high" : "medium";
      }

      return {
        id: buildGroupId(candidate.assetIds),
        strategy,
        confidence,
        canonicalAssetId: canonical.id,
        duplicateAssetIds: duplicateRows.map((row) => row.id),
        reasons: [...candidate.reasons],
        blockers,
        totalQuantityAfter: strategy === "reconcile_quantity" ? totalQuantityAfter : null,
        items: groupRows.map((row) => toAuditItem(row, canonical.id, blockerMap.get(row.id) ?? [])),
      };
    })
    .filter(Boolean) as AssetDuplicateAuditGroup[];

  groups.sort((left, right) => {
    const strategyRank = (strategy: AssetDuplicateAuditStrategy) =>
      strategy === "reconcile_quantity" ? 0 : strategy === "archive_duplicates" ? 1 : 2;
    const strategyDiff = strategyRank(left.strategy) - strategyRank(right.strategy);
    if (strategyDiff !== 0) return strategyDiff;
    return right.items.length - left.items.length;
  });

  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    groups,
    summary: {
      totalGroups: groups.length,
      safeArchiveGroups: groups.filter((group) => group.strategy === "archive_duplicates").length,
      reconcileGroups: groups.filter((group) => group.strategy === "reconcile_quantity").length,
      reviewGroups: groups.filter((group) => group.strategy === "review").length,
      affectedAssets: new Set(groups.flatMap((group) => group.items.map((item) => item.id))).size,
      archivableDuplicates: groups
        .filter((group) => group.strategy !== "review")
        .reduce((total, group) => total + group.duplicateAssetIds.length, 0),
    },
  };
};
