import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { DatabaseSync } from "node:sqlite";

import type {
  ApplyInvoiceExtractionCommand,
  BulkLinkInvoiceExtractionsCommand,
  BulkLinkInvoiceExtractionsResult,
  DismissInvoiceExtractionCommand,
  EnqueueInvoiceBatchCommand,
  EnqueueInvoiceBatchResult,
  InvoiceExtraction,
  InvoiceExtractionAllocation,
  InvoiceExtractionMutationResult,
  InvoiceExtractionProjectInput,
  InvoiceExtractionProjectTag,
  InvoiceExtractionStatus,
  InvoiceInboxFileInput,
  InvoiceInboxListQuery,
  RetryInvoiceExtractionsCommand,
  RetryInvoiceExtractionsResult,
  UpdateInvoiceExtractionCommand,
} from "@contracts";

import type { createTreasuryMutationService } from "./treasuryMutationService";
import type { SupabaseDocumentStorage } from "./supabaseDocumentStorageService";
import { assertPathWithinRoot } from "../../security/pathSafety";
import { ensurePrivateDirectory, writePrivateFile } from "../../security/storagePrivacy";
import { buildZip, dedupeZipNames } from "./zipWriter";

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;
const ACCEPTED_MIME = /image\/(png|jpe?g|webp)|application\/pdf/i;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

type TreasuryMutations = ReturnType<typeof createTreasuryMutationService>;

export type InvoiceInboxServiceOptions = {
  userDataPath: string;
  /** Optional override for where new invoice files are stored. */
  getStorageRoot?: () => string;
  treasuryMutations: TreasuryMutations;
  /** Optional cloud document storage so files sync across machines. */
  storage?: Pick<SupabaseDocumentStorage, "upload" | "download" | "enabled">;
  now?: () => string;
};

/** Fields written by the extraction engine once a document is parsed. */
export type InvoiceExtractionFields = {
  supplierName: string | null;
  supplierRnc: string | null;
  ncf: string | null;
  invoiceDate: string | null;
  subtotal: number | null;
  itbis: number | null;
  total: number | null;
  currency: string | null;
  dgiiExpenseType: string | null;
  expenseCategory: string | null;
  confidence: number | null;
  rawText: string | null;
};

export type InvoiceAutoMatch = {
  transactionId: string;
  confidence: number;
};

type ExtractionRow = {
  id: string;
  workspace_id: string;
  batch_id: string;
  status: string;
  original_name: string;
  storage_path: string;
  storage_object_key: string | null;
  mime_type: string;
  byte_size: number;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  linked_user_id: string | null;
  linked_user_name: string | null;
  supplier_name: string | null;
  supplier_rnc: string | null;
  ncf: string | null;
  invoice_date: string | null;
  subtotal: number | null;
  itbis: number | null;
  total: number | null;
  currency: string | null;
  dgii_expense_type: string | null;
  expense_category: string | null;
  confidence: number | null;
  raw_text: string | null;
  suggested_transaction_id: string | null;
  match_confidence: number | null;
  applied_transaction_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type AllocationRow = {
  linked_entity_id: string;
  id: string;
  payment_instrument_id: string | null;
  payment_instrument_label: string | null;
  transaction_id: string | null;
  transaction_label: string | null;
  amount_applied: number | null;
  amount_currency: string | null;
  allocation_status: string;
  cycle_start: string | null;
  cycle_end: string | null;
  notes: string | null;
};

const ensureTable = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_extractions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      original_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      uploaded_by_user_id TEXT,
      uploaded_by_name TEXT,
      supplier_name TEXT,
      supplier_rnc TEXT,
      ncf TEXT,
      invoice_date TEXT,
      subtotal REAL,
      itbis REAL,
      total REAL,
      currency TEXT,
      dgii_expense_type TEXT,
      expense_category TEXT,
      confidence REAL,
      raw_text TEXT,
      suggested_transaction_id TEXT,
      match_confidence REAL,
      applied_transaction_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_invoice_extractions_workspace
       ON invoice_extractions (workspace_id, status, created_at);`,
  );
  // Idempotent migration for inboxes created before uploader columns existed.
  const columns = (db.prepare(`PRAGMA table_info(invoice_extractions)`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
  if (!columns.includes("uploaded_by_user_id")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN uploaded_by_user_id TEXT`);
  }
  if (!columns.includes("uploaded_by_name")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN uploaded_by_name TEXT`);
  }
  if (!columns.includes("supplier_name")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN supplier_name TEXT`);
  }
  if (!columns.includes("supplier_rnc")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN supplier_rnc TEXT`);
  }
  if (!columns.includes("ncf")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN ncf TEXT`);
  }
  if (!columns.includes("invoice_date")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN invoice_date TEXT`);
  }
  // Iteration 2: who the expense really belongs to (distinct from uploader),
  // the synced cloud object key for the file bytes, and the multi-project tags.
  if (!columns.includes("linked_user_id")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN linked_user_id TEXT`);
  }
  if (!columns.includes("linked_user_name")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN linked_user_name TEXT`);
  }
  if (!columns.includes("storage_object_key")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN storage_object_key TEXT`);
  }
  // Iteration 3: sha256 of the file bytes for exact cross-machine dedupe.
  if (!columns.includes("content_hash")) {
    db.exec(`ALTER TABLE invoice_extractions ADD COLUMN content_hash TEXT`);
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_invoice_extractions_content_hash
       ON invoice_extractions (workspace_id, content_hash);`,
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_extraction_projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      invoice_extraction_id TEXT NOT NULL,
      project_id TEXT,
      project_name_snapshot TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_invoice_extraction_projects_extraction
       ON invoice_extraction_projects (invoice_extraction_id);`,
  );
};

const mapAllocation = (row: AllocationRow): InvoiceExtractionAllocation => ({
  id: row.id,
  paymentInstrumentId: row.payment_instrument_id,
  paymentInstrumentLabel: row.payment_instrument_label,
  transactionId: row.transaction_id,
  transactionLabel: row.transaction_label,
  amountApplied: row.amount_applied,
  amountCurrency: row.amount_currency,
  allocationStatus: row.allocation_status as InvoiceExtractionAllocation["allocationStatus"],
  cycleStart: row.cycle_start,
  cycleEnd: row.cycle_end,
  notes: row.notes,
});

const mapRow = (
  row: ExtractionRow,
  projects: InvoiceExtractionProjectTag[] = [],
  allocation: InvoiceExtractionAllocation | null = null,
): InvoiceExtraction => ({
  id: row.id,
  workspaceId: row.workspace_id,
  batchId: row.batch_id,
  status: row.status as InvoiceExtractionStatus,
  originalName: row.original_name,
  mimeType: row.mime_type,
  byteSize: row.byte_size,
  uploadedByUserId: row.uploaded_by_user_id,
  uploadedByName: row.uploaded_by_name,
  linkedUserId: row.linked_user_id,
  linkedUserName: row.linked_user_name,
  projects,
  allocation,
  supplierName: row.supplier_name,
  supplierRnc: row.supplier_rnc,
  ncf: row.ncf,
  invoiceDate: row.invoice_date,
  subtotal: row.subtotal,
  itbis: row.itbis,
  total: row.total,
  currency: row.currency,
  dgiiExpenseType: row.dgii_expense_type,
  expenseCategory: row.expense_category,
  confidence: row.confidence,
  rawText: row.raw_text,
  suggestedTransactionId: row.suggested_transaction_id,
  matchConfidence: row.match_confidence,
  appliedTransactionId: row.applied_transaction_id,
  errorMessage: row.error_message,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const extensionFor = (mimeType: string, fileName: string): string => {
  const lowerName = fileName.toLowerCase();
  const match = lowerName.match(/\.(png|jpe?g|webp|pdf)$/);
  if (match) return match[0];
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.includes("png")) return ".png";
  if (lowerMime.includes("jpeg") || lowerMime.includes("jpg")) return ".jpg";
  if (lowerMime.includes("webp")) return ".webp";
  if (lowerMime.includes("pdf")) return ".pdf";
  return ".bin";
};

const decodeDataUrl = (file: InvoiceInboxFileInput): { buffer: Buffer; mimeType: string } => {
  const match = file.dataUrl.match(DATA_URL_RE);
  const mimeType = match?.[1] || file.mimeType;
  const buffer = match ? Buffer.from(match[2] ?? "", "base64") : Buffer.from("");
  return { buffer, mimeType };
};

export const createInvoiceInboxService = (db: DatabaseSync, options: InvoiceInboxServiceOptions) => {
  ensureTable(db);
  const now = () => options.now?.() ?? new Date().toISOString();
  // `storage_path` lives in SQLite — refuse any read/write that escapes the
  // workspace storage root (symlink or `..` traversal).
  const ensureSafePath = (target: string) => assertPathWithinRoot(target, options.userDataPath);

  /**
   * Enqueue an `invoice_extraction` row into the shared sync outbox so it
   * propagates to Supabase (and from there to other machines). The outbox
   * worker's `resolveSupabaseDomainUpserts` materializes the row + its
   * project tags. Best-effort: a missing/locked outbox never blocks the
   * local write.
   */
  const enqueueOutbox = (workspaceIdOrNull: string | null, extractionId: string) => {
    try {
      const workspaceId =
        workspaceIdOrNull ??
        (
          db
            .prepare(`SELECT workspace_id FROM invoice_extractions WHERE id = ? LIMIT 1`)
            .get(extractionId) as { workspace_id: string } | undefined
        )?.workspace_id;
      if (!workspaceId) return;
      const timestamp = now();
      db.prepare(
        `INSERT INTO sync_outbox (
           id, workspace_id, entity_type, entity_id, operation_type,
           payload_json, status, attempt_count, last_error, next_retry_at,
           created_at, updated_at
         ) VALUES (?, ?, 'invoice_extraction', ?, 'upsert', ?, 'pending', 0, NULL, ?, ?, ?)`,
      ).run(
        `sync-inv-${extractionId}-${randomUUID().slice(0, 8)}`,
        workspaceId,
        extractionId,
        JSON.stringify({ id: extractionId }),
        timestamp,
        timestamp,
        timestamp,
      );
    } catch (error) {
      // Sync is eventually-consistent; surface but don't fail the mutation.
      // eslint-disable-next-line no-console
      console.warn("[invoice-inbox] enqueueOutbox failed", error);
    }
  };

  const getRow = (workspaceId: string, extractionId: string): ExtractionRow | undefined =>
    db
      .prepare(`SELECT * FROM invoice_extractions WHERE id = ? AND workspace_id = ? LIMIT 1`)
      .get(extractionId, workspaceId) as ExtractionRow | undefined;

  const loadProjectsFor = (extractionIds: string[]): Map<string, InvoiceExtractionProjectTag[]> => {
    const byId = new Map<string, InvoiceExtractionProjectTag[]>();
    if (!extractionIds.length) return byId;
    const placeholders = extractionIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT invoice_extraction_id, project_id, project_name_snapshot
           FROM invoice_extraction_projects
          WHERE invoice_extraction_id IN (${placeholders})
          ORDER BY created_at ASC`,
      )
      .all(...extractionIds) as Array<{
      invoice_extraction_id: string;
      project_id: string | null;
      project_name_snapshot: string | null;
    }>;
    for (const row of rows) {
      const list = byId.get(row.invoice_extraction_id) ?? [];
      list.push({ projectId: row.project_id, projectName: row.project_name_snapshot });
      byId.set(row.invoice_extraction_id, list);
    }
    return byId;
  };

  const loadAllocationsFor = (extractionIds: string[]): Map<string, InvoiceExtractionAllocation> => {
    const byId = new Map<string, InvoiceExtractionAllocation>();
    if (!extractionIds.length) return byId;
    const placeholders = extractionIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT
           l.linked_entity_id,
           l.id,
           l.payment_instrument_id,
           acc.account_label AS payment_instrument_label,
           l.transaction_id,
           CASE
             WHEN t.id IS NULL THEN NULL
             ELSE t.txn_date || ' · ' || COALESCE(NULLIF(t.raw_description, ''), t.reference, t.id)
           END AS transaction_label,
           l.amount_applied,
           l.amount_currency,
           l.allocation_status,
           l.cycle_start,
           l.cycle_end,
           l.notes
         FROM transaction_links l
         LEFT JOIN bank_accounts acc ON acc.id = l.payment_instrument_id
         LEFT JOIN bank_transactions t ON t.id = l.transaction_id
         WHERE l.linked_entity_type = 'invoice_extraction'
           AND l.linked_entity_id IN (${placeholders})
         ORDER BY
           CASE WHEN l.allocation_status NOT IN ('rejected', 'reimbursed') THEN 0 ELSE 1 END,
           l.updated_at DESC,
           l.created_at DESC`,
      )
      .all(...extractionIds) as AllocationRow[];
    for (const row of rows) {
      if (byId.has(row.linked_entity_id)) continue;
      byId.set(row.linked_entity_id, mapAllocation(row));
    }
    return byId;
  };

  /** Replace the full set of project tags for one extraction. */
  const replaceProjects = (
    workspaceId: string,
    extractionId: string,
    projects: InvoiceExtractionProjectInput[],
  ) => {
    db.prepare(`DELETE FROM invoice_extraction_projects WHERE invoice_extraction_id = ?`).run(extractionId);
    if (!projects.length) return;
    const insert = db.prepare(
      `INSERT INTO invoice_extraction_projects (
         id, workspace_id, invoice_extraction_id, project_id, project_name_snapshot, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const timestamp = now();
    const seen = new Set<string>();
    for (const project of projects) {
      const projectId = project.projectId?.trim();
      if (!projectId || seen.has(projectId)) continue;
      seen.add(projectId);
      const name =
        project.projectName?.trim() ||
        (
          db
            .prepare(`SELECT name FROM projects WHERE id = ? LIMIT 1`)
            .get(projectId) as { name: string } | undefined
        )?.name ||
        null;
      insert.run(`inv-proj-${randomUUID()}`, workspaceId, extractionId, projectId, name, timestamp);
    }
  };

  const touch = (id: string) => {
    db.prepare(`UPDATE invoice_extractions SET updated_at = ? WHERE id = ?`).run(now(), id);
  };

  /**
   * Persist files to disk + a pending row each. Unsupported/empty files are
   * skipped (counted) rather than failing the whole batch.
   */
  const enqueueBatch = (
    input: EnqueueInvoiceBatchCommand,
  ): { result: EnqueueInvoiceBatchResult; ids: string[] } => {
    const batchId = `inv-batch-${randomUUID()}`;
    const storageRoot = options.getStorageRoot?.() || options.userDataPath;
    const directory = path.join(storageRoot, "invoice-inbox", input.workspaceId);
    fs.mkdirSync(directory, { recursive: true });
    ensurePrivateDirectory(directory);

    const insert = db.prepare(
      `INSERT INTO invoice_extractions (
         id, workspace_id, batch_id, status, original_name, storage_path, storage_object_key,
         mime_type, byte_size, content_hash, uploaded_by_user_id, uploaded_by_name, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const ids: string[] = [];
    let skipped = 0;
    const timestamp = now();

    for (const file of input.files) {
      const { buffer, mimeType } = decodeDataUrl(file);
      if (!buffer.length || !ACCEPTED_MIME.test(mimeType)) {
        skipped += 1;
        continue;
      }
      const id = `inv-${randomUUID()}`;
      const extension = extensionFor(mimeType, file.name);
      const storagePath = path.join(directory, `${id}${extension}`);
      const storageObjectKey = `${input.workspaceId}/invoices/${id}${extension}`;
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      writePrivateFile(storagePath, buffer);
      insert.run(
        id,
        input.workspaceId,
        batchId,
        file.name.trim() || "factura",
        storagePath,
        storageObjectKey,
        mimeType,
        buffer.length,
        contentHash,
        input.uploadedByUserId?.trim() || null,
        input.uploadedByName?.trim() || null,
        timestamp,
        timestamp,
      );
      enqueueOutbox(input.workspaceId, id);
      ids.push(id);
    }

    return {
      ids,
      result: {
        batchId,
        queuedCount: ids.length,
        skippedCount: skipped,
        summary:
          ids.length > 0
            ? `Encoladas ${ids.length} factura(s)${skipped ? `, ${skipped} omitida(s)` : ""}.`
            : "No se encoló ninguna factura (formato no soportado).",
      },
    };
  };

  const list = (query: InvoiceInboxListQuery): InvoiceExtraction[] => {
    const clauses = ["workspace_id = ?"];
    const params: Array<string | number> = [query.workspaceId];
    if (query.batchId) {
      clauses.push("batch_id = ?");
      params.push(query.batchId);
    }
    if (!query.includeResolved) {
      clauses.push("status NOT IN ('dismissed')");
    }
    const rows = db
      .prepare(
        `SELECT * FROM invoice_extractions WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, rowid DESC`,
      )
      .all(...params) as ExtractionRow[];
    const extractionIds = rows.map((row) => row.id);
    const projectsById = loadProjectsFor(extractionIds);
    const allocationsById = loadAllocationsFor(extractionIds);
    return rows.map((row) => mapRow(row, projectsById.get(row.id) ?? [], allocationsById.get(row.id) ?? null));
  };

  const getFileBuffer = async (
    id: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> => {
    const row = db
      .prepare(
        `SELECT storage_path, storage_object_key, mime_type, original_name
           FROM invoice_extractions WHERE id = ? LIMIT 1`,
      )
      .get(id) as
      | { storage_path: string; storage_object_key: string | null; mime_type: string; original_name: string }
      | undefined;
    if (!row) return null;
    if (row.storage_path) {
      const safePath = ensureSafePath(row.storage_path);
      if (fs.existsSync(safePath)) {
        return { buffer: fs.readFileSync(safePath), mimeType: row.mime_type, fileName: row.original_name };
      }
    }
    // Not on this machine's disk (e.g. a teammate uploaded it): fetch the bytes
    // from cloud storage and cache them locally for next time.
    if (options.storage?.enabled && row.storage_object_key) {
      const buffer = await options.storage.download(row.storage_object_key);
      if (buffer) {
        try {
          const safePath = ensureSafePath(row.storage_path);
          fs.mkdirSync(path.dirname(safePath), { recursive: true });
          ensurePrivateDirectory(path.dirname(safePath));
          writePrivateFile(safePath, buffer);
        } catch {
          /* caching is best-effort */
        }
        return { buffer, mimeType: row.mime_type, fileName: row.original_name };
      }
    }
    return null;
  };

  // Build a safe, human filename for a download: prefer supplier + date, fall
  // back to the original name; always keep a sensible extension.
  const downloadFileNameFor = (row: {
    original_name: string;
    supplier_name: string | null;
    invoice_date: string | null;
    mime_type: string;
  }): string => {
    const extMatch = row.original_name.match(/\.(png|jpe?g|webp|pdf)$/i);
    const ext = extMatch
      ? extMatch[0].toLowerCase()
      : row.mime_type.includes("pdf")
        ? ".pdf"
        : row.mime_type.includes("png")
          ? ".png"
          : row.mime_type.includes("webp")
            ? ".webp"
            : ".jpg";
    const base = [row.supplier_name?.trim(), row.invoice_date?.trim()]
      .filter(Boolean)
      .join(" · ")
      .replace(/[\\/:*?"<>|]/g, "-");
    return base ? `${base}${ext}` : row.original_name;
  };

  /** Resolve one document for download (workspace-scoped). */
  const getDownload = async (
    workspaceId: string,
    extractionId: string,
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null> => {
    const meta = db
      .prepare(
        `SELECT original_name, supplier_name, invoice_date, mime_type
           FROM invoice_extractions WHERE id = ? AND workspace_id = ? LIMIT 1`,
      )
      .get(extractionId, workspaceId) as
      | { original_name: string; supplier_name: string | null; invoice_date: string | null; mime_type: string }
      | undefined;
    if (!meta) return null;
    const file = await getFileBuffer(extractionId);
    if (!file) return null;
    return { buffer: file.buffer, mimeType: file.mimeType, fileName: downloadFileNameFor(meta) };
  };

  /** Bundle many documents into a single ZIP (workspace-scoped). */
  const buildBatchZip = async (
    workspaceId: string,
    extractionIds: string[],
  ): Promise<{ buffer: Buffer; fileName: string; includedCount: number; missingCount: number } | null> => {
    const files: Array<{ name: string; data: Buffer }> = [];
    let missing = 0;
    for (const id of extractionIds) {
      const doc = await getDownload(workspaceId, id);
      if (doc) files.push({ name: doc.fileName, data: doc.buffer });
      else missing += 1;
    }
    if (!files.length) return null;
    const names = dedupeZipNames(files.map((f) => f.name));
    const entries = files.map((f, index) => ({ name: names[index], data: f.data }));
    const today = (options.now?.() ?? new Date().toISOString()).slice(0, 10);
    return {
      buffer: buildZip(entries),
      fileName: `facturas-${today}.zip`,
      includedCount: files.length,
      missingCount: missing,
    };
  };

  /** Upload a document's bytes to cloud storage (best-effort, idempotent). */
  const uploadDocument = async (id: string): Promise<void> => {
    if (!options.storage?.enabled) return;
    const row = db
      .prepare(
        `SELECT storage_path, storage_object_key, mime_type FROM invoice_extractions WHERE id = ? LIMIT 1`,
      )
      .get(id) as
      | { storage_path: string; storage_object_key: string | null; mime_type: string }
      | undefined;
    if (!row?.storage_object_key || !row.storage_path) return;
    const safePath = ensureSafePath(row.storage_path);
    if (!fs.existsSync(safePath)) return;
    await options.storage.upload(row.storage_object_key, fs.readFileSync(safePath), row.mime_type);
  };

  /**
   * Backfill `content_hash` for rows uploaded before the column existed (and
   * for rows pulled from other machines without it) so duplicate detection can
   * see them. Pulls bytes from local disk or cloud storage. Best-effort,
   * batched. Returns how many were hashed.
   */
  const backfillContentHashes = async (workspaceId: string, limit = 200): Promise<number> => {
    const rows = db
      .prepare(
        `SELECT id FROM invoice_extractions
           WHERE workspace_id = ? AND (content_hash IS NULL OR content_hash = '')
           ORDER BY created_at DESC LIMIT ?`,
      )
      .all(workspaceId, limit) as Array<{ id: string }>;
    let updated = 0;
    for (const row of rows) {
      const file = await getFileBuffer(row.id);
      if (!file) continue;
      const hash = createHash("sha256").update(file.buffer).digest("hex");
      db.prepare(`UPDATE invoice_extractions SET content_hash = ? WHERE id = ?`).run(hash, row.id);
      enqueueOutbox(workspaceId, row.id);
      updated += 1;
    }
    return updated;
  };

  /**
   * Groups of exact-duplicate invoices (same file bytes) that still need
   * resolution — the cross-machine case (uploaded from two machines) and
   * accidental re-uploads. Excludes already-dismissed rows.
   */
  const findDuplicateGroups = (workspaceId: string): Array<{ contentHash: string; items: InvoiceExtraction[] }> => {
    const hashes = db
      .prepare(
        `SELECT content_hash FROM invoice_extractions
           WHERE workspace_id = ? AND content_hash IS NOT NULL AND content_hash <> '' AND status <> 'dismissed'
           GROUP BY content_hash HAVING COUNT(*) > 1`,
      )
      .all(workspaceId) as Array<{ content_hash: string }>;
    if (!hashes.length) return [];
    return hashes.map(({ content_hash }) => {
      const rows = db
        .prepare(
          `SELECT * FROM invoice_extractions
             WHERE workspace_id = ? AND content_hash = ? AND status <> 'dismissed'
             ORDER BY created_at ASC, rowid ASC`,
        )
        .all(workspaceId, content_hash) as ExtractionRow[];
      const projectsById = loadProjectsFor(rows.map((r) => r.id));
      return {
        contentHash: content_hash,
        items: rows.map((r) => mapRow(r, projectsById.get(r.id) ?? [])),
      };
    });
  };

  const listPendingIds = (): string[] =>
    (db.prepare(`SELECT id FROM invoice_extractions WHERE status = 'pending' ORDER BY created_at ASC`).all() as Array<{
      id: string;
    }>).map((r) => r.id);

  const setProcessing = (id: string) => {
    db.prepare(`UPDATE invoice_extractions SET status = 'processing', updated_at = ? WHERE id = ?`).run(now(), id);
  };

  const recordFailure = (id: string, message: string) => {
    db.prepare(
      `UPDATE invoice_extractions SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,
    ).run(message.slice(0, 500), now(), id);
    enqueueOutbox(null, id);
  };

  /**
   * Suggest a debit bank movement that plausibly paid this invoice: same
   * workspace, unclassified (no DGII type yet), amount within ~1% of total and
   * posting date within ±7 days of the invoice date. Pure suggestion.
   */
  const autoMatch = (workspaceId: string, fields: InvoiceExtractionFields): InvoiceAutoMatch | null => {
    if (fields.total == null || fields.total <= 0) return null;
    const tolerance = Math.max(1, fields.total * 0.01);
    const candidates = db
      .prepare(
        `SELECT t.id, t.txn_date, t.amount
           FROM bank_transactions t
           LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
          WHERE t.workspace_id = ?
            AND t.direction = 'debit'
            AND (a.dgii_expense_type IS NULL OR a.dgii_expense_type = '')
            AND ABS(t.amount - ?) <= ?
          LIMIT 50`,
      )
      .all(workspaceId, fields.total, tolerance) as Array<{ id: string; txn_date: string; amount: number }>;
    if (!candidates.length) return null;

    const invoiceTime = fields.invoiceDate ? Date.parse(fields.invoiceDate) : Number.NaN;
    let best: InvoiceAutoMatch | null = null;
    for (const candidate of candidates) {
      const amountCloseness = 1 - Math.min(1, Math.abs(candidate.amount - fields.total) / tolerance);
      let dateScore = 0.5;
      if (!Number.isNaN(invoiceTime)) {
        const candidateTime = Date.parse(candidate.txn_date);
        if (!Number.isNaN(candidateTime)) {
          const days = Math.abs(candidateTime - invoiceTime) / 86_400_000;
          if (days > 7) continue;
          dateScore = 1 - days / 7;
        }
      }
      const confidence = round2(0.6 * amountCloseness + 0.4 * dateScore);
      if (!best || confidence > best.confidence) {
        best = { transactionId: candidate.id, confidence };
      }
    }
    return best;
  };

  const recordExtraction = (id: string, fields: InvoiceExtractionFields, match: InvoiceAutoMatch | null) => {
    db.prepare(
      `UPDATE invoice_extractions SET
         status = 'extracted',
         supplier_name = ?, supplier_rnc = ?, ncf = ?, invoice_date = ?,
         subtotal = ?, itbis = ?, total = ?, currency = ?,
         dgii_expense_type = ?, expense_category = ?, confidence = ?, raw_text = ?,
         suggested_transaction_id = ?, match_confidence = ?,
         error_message = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      fields.supplierName,
      fields.supplierRnc,
      fields.ncf,
      fields.invoiceDate,
      fields.subtotal,
      fields.itbis,
      fields.total,
      fields.currency,
      fields.dgiiExpenseType,
      fields.expenseCategory,
      fields.confidence,
      fields.rawText ? fields.rawText.slice(0, 8_000) : null,
      match?.transactionId ?? null,
      match?.confidence ?? null,
      now(),
      id,
    );
    enqueueOutbox(null, id);
  };

  const update = (input: UpdateInvoiceExtractionCommand): InvoiceExtractionMutationResult => {
    const row = getRow(input.workspaceId, input.extractionId);
    if (!row) throw new Error("Factura no encontrada.");
    const next = {
      supplier_name: input.supplierName !== undefined ? input.supplierName : row.supplier_name,
      supplier_rnc: input.supplierRnc !== undefined ? input.supplierRnc : row.supplier_rnc,
      ncf: input.ncf !== undefined ? input.ncf : row.ncf,
      invoice_date: input.invoiceDate !== undefined ? input.invoiceDate : row.invoice_date,
      subtotal: input.subtotal !== undefined ? input.subtotal : row.subtotal,
      itbis: input.itbis !== undefined ? input.itbis : row.itbis,
      total: input.total !== undefined ? input.total : row.total,
      currency: input.currency !== undefined ? input.currency : row.currency,
      dgii_expense_type: input.dgiiExpenseType !== undefined ? input.dgiiExpenseType : row.dgii_expense_type,
      expense_category: input.expenseCategory !== undefined ? input.expenseCategory : row.expense_category,
      linked_user_id: input.linkedUserId !== undefined ? input.linkedUserId : row.linked_user_id,
      linked_user_name: input.linkedUserName !== undefined ? input.linkedUserName : row.linked_user_name,
    };
    db.prepare(
      `UPDATE invoice_extractions SET
         supplier_name = ?, supplier_rnc = ?, ncf = ?, invoice_date = ?,
         subtotal = ?, itbis = ?, total = ?, currency = ?,
         dgii_expense_type = ?, expense_category = ?,
         linked_user_id = ?, linked_user_name = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      next.supplier_name,
      next.supplier_rnc,
      next.ncf,
      next.invoice_date,
      next.subtotal,
      next.itbis,
      next.total,
      next.currency,
      next.dgii_expense_type,
      next.expense_category,
      next.linked_user_id,
      next.linked_user_name,
      now(),
      input.extractionId,
    );
    if (input.projects !== undefined) {
      replaceProjects(input.workspaceId, input.extractionId, input.projects);
    }
    enqueueOutbox(input.workspaceId, input.extractionId);
    return { extractionId: input.extractionId, status: row.status as InvoiceExtractionStatus, summary: "Factura actualizada." };
  };

  /** Assign linked user and/or project tags to many invoices at once. */
  const bulkLink = (input: BulkLinkInvoiceExtractionsCommand): BulkLinkInvoiceExtractionsResult => {
    let updatedCount = 0;
    for (const extractionId of input.extractionIds) {
      const row = getRow(input.workspaceId, extractionId);
      if (!row) continue;
      if (input.linkedUserId !== undefined || input.linkedUserName !== undefined) {
        db.prepare(
          `UPDATE invoice_extractions SET linked_user_id = ?, linked_user_name = ?, updated_at = ? WHERE id = ?`,
        ).run(
          input.linkedUserId !== undefined ? input.linkedUserId : row.linked_user_id,
          input.linkedUserName !== undefined ? input.linkedUserName : row.linked_user_name,
          now(),
          extractionId,
        );
      }
      if (input.projects !== undefined) {
        replaceProjects(input.workspaceId, extractionId, input.projects);
        db.prepare(`UPDATE invoice_extractions SET updated_at = ? WHERE id = ?`).run(now(), extractionId);
      }
      enqueueOutbox(input.workspaceId, extractionId);
      updatedCount += 1;
    }
    return {
      updatedCount,
      summary:
        updatedCount > 0
          ? `Se actualizaron ${updatedCount} factura(s).`
          : "No se actualizó ninguna factura.",
    };
  };

  const dismiss = (input: DismissInvoiceExtractionCommand): InvoiceExtractionMutationResult => {
    const row = getRow(input.workspaceId, input.extractionId);
    if (!row) throw new Error("Factura no encontrada.");
    db.prepare(`UPDATE invoice_extractions SET status = 'dismissed', updated_at = ? WHERE id = ?`).run(
      now(),
      input.extractionId,
    );
    enqueueOutbox(input.workspaceId, input.extractionId);
    return { extractionId: input.extractionId, status: "dismissed", summary: "Factura descartada." };
  };

  const retry = (input: RetryInvoiceExtractionsCommand): RetryInvoiceExtractionsResult => {
    const uniqueIds = Array.from(new Set(input.extractionIds));
    if (!uniqueIds.length) {
      return { queuedCount: 0, skippedCount: 0, extractionIds: [], summary: "No hay facturas para reintentar." };
    }

    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT id, status
           FROM invoice_extractions
          WHERE workspace_id = ? AND id IN (${placeholders})`,
      )
      .all(input.workspaceId, ...uniqueIds) as Array<{ id: string; status: InvoiceExtractionStatus }>;

    const retryable = rows
      .filter((row) => row.status !== "processing" && row.status !== "applied" && row.status !== "dismissed")
      .map((row) => row.id);

    if (retryable.length) {
      const retryPlaceholders = retryable.map(() => "?").join(", ");
      db.prepare(
        `UPDATE invoice_extractions
            SET status = 'pending',
                error_message = NULL,
                suggested_transaction_id = NULL,
                match_confidence = NULL,
                updated_at = ?
          WHERE workspace_id = ? AND id IN (${retryPlaceholders})`,
      ).run(now(), input.workspaceId, ...retryable);
      for (const id of retryable) {
        enqueueOutbox(input.workspaceId, id);
      }
    }

    const skippedCount = uniqueIds.length - retryable.length;
    return {
      queuedCount: retryable.length,
      skippedCount,
      extractionIds: retryable,
      summary:
        retryable.length > 0
          ? `Se reintentará el procesamiento de ${retryable.length} factura(s).`
          : "No hay facturas reintentables en la selección.",
    };
  };

  /**
   * Human-approved write: annotate the chosen movement with supplier/NCF/RNC +
   * expense category, then set the DGII-deductible amount so it lands in the
   * 606 deductible ledger. Both delegate to the treasury mutation service
   * (idempotent, reversible via Undo). Marks the extraction `applied`.
   */
  const applyExtraction = (input: ApplyInvoiceExtractionCommand): InvoiceExtractionMutationResult => {
    const row = getRow(input.workspaceId, input.extractionId);
    if (!row) throw new Error("Factura no encontrada.");

    const baseCommandId = `inv-apply-${input.extractionId}`;
    const itbisNote = row.itbis != null ? `ITBIS ${row.itbis}` : null;
    const ncfNote = row.ncf ? `NCF ${row.ncf}` : null;
    const note = [ncfNote, itbisNote, "Aplicado desde bandeja de facturas"].filter(Boolean).join(" · ");

    options.treasuryMutations.annotateTransaction({
      commandId: `${baseCommandId}-annotate`,
      workspaceId: input.workspaceId,
      actorType: "user",
      sourceChannel: "desktop",
      transactionId: input.transactionId,
      txnKind: "expense",
      counterparty: row.supplier_name,
      counterpartyRnc: row.supplier_rnc,
      expenseCategory: row.expense_category,
      supplierNcf: row.ncf,
      dgiiExpenseType: row.dgii_expense_type,
      notes: note,
    });

    const deductibleAmount =
      input.deductibleAmount != null ? input.deductibleAmount : row.itbis ?? row.total ?? 0;
    options.treasuryMutations.reviewReimbursement({
      commandId: `${baseCommandId}-review`,
      workspaceId: input.workspaceId,
      actorType: "user",
      sourceChannel: "desktop",
      transactionId: input.transactionId,
      reimbursementStatus: deductibleAmount > 0 ? "accepted" : "rejected",
      deductibleAmount,
      supplierNcf: row.ncf,
      dgiiExpenseType: row.dgii_expense_type,
      fiscalPeriod: input.fiscalPeriod ?? (row.invoice_date ? row.invoice_date.slice(0, 7) : null),
      fiscalStatus: deductibleAmount > 0 ? "accepted" : "rejected",
      notes: note,
    });

    db.prepare(
      `UPDATE invoice_extractions SET status = 'applied', applied_transaction_id = ?, updated_at = ? WHERE id = ?`,
    ).run(input.transactionId, now(), input.extractionId);
    enqueueOutbox(input.workspaceId, input.extractionId);

    return {
      extractionId: input.extractionId,
      status: "applied",
      summary: "Factura aplicada al movimiento y enviada al libro deducible.",
    };
  };

  return {
    enqueueBatch,
    list,
    getFileBuffer,
    getDownload,
    buildBatchZip,
    uploadDocument,
    backfillContentHashes,
    findDuplicateGroups,
    listPendingIds,
    setProcessing,
    recordExtraction,
    recordFailure,
    autoMatch,
    update,
    bulkLink,
    retry,
    dismiss,
    applyExtraction,
    touch,
  };
};

export type InvoiceInboxService = ReturnType<typeof createInvoiceInboxService>;
