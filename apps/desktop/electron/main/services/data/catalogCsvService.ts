import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_WORKSPACE_ID } from "@contracts";
import type {
  CatalogCsvImportError,
  CatalogCsvImportPreview,
  CatalogCsvImportResult,
  CatalogCsvImportStrategy,
  CatalogEntityType,
  ExportCatalogCsvInput,
  ImportCatalogCsvInput,
  PreviewCatalogCsvImportInput,
} from "@contracts";

import type { CodeGenerationService } from "./codeGenerationService";

const workspaceId = DEFAULT_WORKSPACE_ID;

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const trimValue = (value: string | undefined) => value?.trim() ?? "";
const normalizeOptional = (value: string | undefined) => {
  const nextValue = trimValue(value);
  return nextValue ? nextValue : null;
};
const normalizeKey = (value: string) => trimValue(value).replace(/\s+/g, " ").toLowerCase();

const expectedHeadersByEntity: Record<CatalogEntityType, string[]> = {
  location: ["code", "name", "locationType", "description", "isActive"],
  department: ["code", "name", "description", "isActive"],
  crew: ["fullName", "primaryDepartmentCode", "documentId", "roleLabel", "email", "phone", "notes", "bankAccounts", "isActive"],
  client: ["name", "contactName", "email", "phone", "notes", "isActive"],
  production_company: ["name", "contactName", "email", "phone", "notes", "isActive"],
  manufacturer: ["name", "contactName", "supportEmail", "phone", "notes", "isActive"],
  category: ["code", "name", "description", "isActive"],
  kit: ["code", "name", "description", "notes", "assetQuantities", "isActive"],
};

type ExistingCatalogRow = {
  id: string;
  key: string;
  isActive: boolean;
};

type ImportAnalysisRow =
  | {
      rowNumber: number;
      key: string;
      existingId: string | null;
      entityType: "location";
      payload: { code: string; name: string; locationType: string; description: string | null; isActive: boolean };
    }
  | {
      rowNumber: number;
      key: string;
      existingId: string | null;
      entityType: "department";
      payload: { code: string; name: string; description: string | null; isActive: boolean };
    }
  | {
      rowNumber: number;
      key: string;
      existingId: string | null;
      entityType: "crew";
      payload: {
        fullName: string;
        primaryDepartmentId: string | null;
        documentId: string | null;
        roleLabel: string | null;
        email: string | null;
        phone: string | null;
        notes: string | null;
        bankAccounts: Array<{
          bankName?: string;
          accountHolder?: string;
          accountNumber: string;
          accountType?: string;
          routingNumber?: string;
          notes?: string;
          maskInPreview?: boolean;
        }>;
        isActive: boolean;
      };
    }
  | {
      rowNumber: number;
      key: string;
      existingId: string | null;
      entityType: "client" | "production_company";
      payload: { name: string; contactName: string | null; email: string | null; phone: string | null; notes: string | null; isActive: boolean };
    }
  | {
      rowNumber: number;
      key: string;
      existingId: string | null;
      entityType: "manufacturer";
      payload: {
        name: string;
        contactName: string | null;
        supportEmail: string | null;
        phone: string | null;
        notes: string | null;
        isActive: boolean;
      };
    }
  | {
      rowNumber: number;
      key: string;
      existingId: string | null;
      entityType: "category";
      payload: { code: string; name: string; description: string | null; isActive: boolean };
    }
  | {
      rowNumber: number;
      key: string;
      existingId: string | null;
      entityType: "kit";
      payload: {
        code: string;
        name: string;
        description: string | null;
        notes: string | null;
        assetSelections: Array<{ assetId: string; quantity: number }>;
        isActive: boolean;
      };
    };

type ImportAnalysis = {
  entityType: CatalogEntityType;
  strategy: CatalogCsvImportStrategy;
  totalRows: number;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  invalid: number;
  errors: CatalogCsvImportError[];
  rows: ImportAnalysisRow[];
  missingActiveIds: string[];
};

const parseBooleanValue = (value: string | undefined, fallback = true) => {
  const normalized = trimValue(value).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "y", "active"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "inactive"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value "${value}". Use true/false, yes/no or 1/0.`);
};

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  if (inQuotes) {
    throw new Error("The CSV contains an unterminated quoted value.");
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => trimValue(cell)));
};

const serializeCsv = (headers: string[], rows: Array<Record<string, string>>) => {
  const escapeCell = (value: string) => {
    if (/[",\n\r]/u.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  };

  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((line) => line.map((cell) => escapeCell(String(cell))).join(","))
    .join("\n");
};

const buildIdFilterClause = (ids: string[] | undefined) => {
  const uniqueIds = Array.from(new Set((ids ?? []).map((id) => trimValue(id)).filter(Boolean)));
  if (!uniqueIds.length) {
    return {
      sql: "",
      params: [] as string[],
    };
  }

  return {
    sql: ` AND id IN (${uniqueIds.map(() => "?").join(", ")})`,
    params: uniqueIds,
  };
};

const getExistingRows = (db: DatabaseSync, entityType: CatalogEntityType): ExistingCatalogRow[] => {
  switch (entityType) {
    case "location":
      return db
        .prepare("SELECT id, code, is_active FROM locations WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => ({
          id: (row as { id: string }).id,
          key: normalizeKey((row as { code: string }).code),
          isActive: Boolean((row as { is_active: number }).is_active),
        }));
    case "department":
      return db
        .prepare("SELECT id, code, is_active FROM departments WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => ({
          id: (row as { id: string }).id,
          key: normalizeKey((row as { code: string }).code),
          isActive: Boolean((row as { is_active: number }).is_active),
        }));
    case "crew":
      return db
        .prepare("SELECT id, full_name, is_active FROM crew_members WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => ({
          id: (row as { id: string }).id,
          key: normalizeKey((row as { full_name: string }).full_name),
          isActive: Boolean((row as { is_active: number }).is_active),
        }));
    case "client":
      return db
        .prepare("SELECT id, name, is_active FROM clients WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => ({
          id: (row as { id: string }).id,
          key: normalizeKey((row as { name: string }).name),
          isActive: Boolean((row as { is_active: number }).is_active),
        }));
    case "production_company":
      return db
        .prepare("SELECT id, name, is_active FROM production_companies WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => ({
          id: (row as { id: string }).id,
          key: normalizeKey((row as { name: string }).name),
          isActive: Boolean((row as { is_active: number }).is_active),
        }));
    case "manufacturer":
      return db
        .prepare("SELECT id, name, is_active FROM manufacturers WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => ({
          id: (row as { id: string }).id,
          key: normalizeKey((row as { name: string }).name),
          isActive: Boolean((row as { is_active: number }).is_active),
        }));
    case "category":
      return db
        .prepare("SELECT id, code, is_active FROM asset_categories WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => ({
          id: (row as { id: string }).id,
          key: normalizeKey((row as { code: string }).code),
          isActive: Boolean((row as { is_active: number }).is_active),
        }));
    case "kit":
      return db
        .prepare("SELECT id, code, is_active FROM kits WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => ({
          id: (row as { id: string }).id,
          key: normalizeKey((row as { code: string }).code),
          isActive: Boolean((row as { is_active: number }).is_active),
        }));
  }
};

const getAssetIdByCode = (db: DatabaseSync) => {
  const rows = db
    .prepare(
      `
        SELECT
          assets.id,
          COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code
        FROM assets
        LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
        LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
        WHERE assets.workspace_id = ?
          AND assets.is_active = 1
      `,
    )
    .all(workspaceId) as Array<{ id: string; code: string }>;

  return new Map(rows.map((row) => [normalizeKey(row.code), row.id]));
};

const getDepartmentIdByLookup = (db: DatabaseSync) => {
  const rows = db
    .prepare(
      `
        SELECT id, code, name
        FROM departments
        WHERE workspace_id = ?
      `,
    )
    .all(workspaceId) as Array<{ id: string; code: string; name: string }>;

  const lookup = new Map<string, string>();
  rows.forEach((row) => {
    if (trimValue(row.code)) {
      lookup.set(normalizeKey(row.code), row.id);
    }
    if (trimValue(row.name)) {
      lookup.set(normalizeKey(row.name), row.id);
    }
  });
  return lookup;
};

const parseCrewBankAccounts = (value: string | undefined) => {
  const normalized = trimValue(value);
  if (!normalized) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error("Crew bankAccounts must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Crew bankAccounts must be a JSON array.");
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Crew bankAccounts item ${index + 1} is invalid.`);
    }

    const account = entry as Record<string, unknown>;
    const accountNumber = trimValue(typeof account.accountNumber === "string" ? account.accountNumber : undefined);
    if (!accountNumber) {
      throw new Error(`Crew bankAccounts item ${index + 1} requires accountNumber.`);
    }

    return {
      bankName: normalizeOptional(typeof account.bankName === "string" ? account.bankName : undefined) ?? undefined,
      accountHolder: normalizeOptional(typeof account.accountHolder === "string" ? account.accountHolder : undefined) ?? undefined,
      accountNumber,
      accountType: normalizeOptional(typeof account.accountType === "string" ? account.accountType : undefined) ?? undefined,
      routingNumber: normalizeOptional(typeof account.routingNumber === "string" ? account.routingNumber : undefined) ?? undefined,
      notes: normalizeOptional(typeof account.notes === "string" ? account.notes : undefined) ?? undefined,
      maskInPreview: account.maskInPreview === false ? false : true,
    };
  });
};

const analyzeImport = (db: DatabaseSync, input: PreviewCatalogCsvImportInput): ImportAnalysis => {
  const errors: CatalogCsvImportError[] = [];
  const parsedRows = parseCsv(input.csvText);

  if (!parsedRows.length) {
    throw new Error("The selected CSV is empty.");
  }

  const headers = parsedRows[0].map((header) => trimValue(header));
  const expectedHeaders = expectedHeadersByEntity[input.entityType];
  const missingHeaders = expectedHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length) {
    throw new Error(`The CSV is missing required columns: ${missingHeaders.join(", ")}.`);
  }

  const dataRows = parsedRows.slice(1);
  const existingRows = getExistingRows(db, input.entityType);
  const existingByKey = new Map(existingRows.map((row) => [row.key, row]));
  const assetIdByCode = input.entityType === "kit" ? getAssetIdByCode(db) : null;
  const departmentIdByLookup = input.entityType === "crew" ? getDepartmentIdByLookup(db) : null;
  const seenKeys = new Set<string>();
  const operations: ImportAnalysisRow[] = [];

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const readRecord = (row: string[]) =>
    headers.reduce<Record<string, string>>((accumulator, header, index) => {
      accumulator[header] = row[index] ?? "";
      return accumulator;
    }, {});

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const record = readRecord(row);

    if (Object.values(record).every((value) => !trimValue(value))) {
      skipped += 1;
      return;
    }

    try {
      switch (input.entityType) {
        case "location": {
          const code = trimValue(record.code).toUpperCase();
          const key = normalizeKey(code);
          if (!key) {
            throw new Error("Location code is required.");
          }
          if (!trimValue(record.name)) {
            throw new Error("Location name is required.");
          }
          if (!trimValue(record.locationType)) {
            throw new Error("Location type is required.");
          }
          if (seenKeys.has(key)) {
            throw new Error(`Duplicate location code ${code} inside the CSV.`);
          }
          seenKeys.add(key);
          operations.push({
            rowNumber,
            key,
            existingId: existingByKey.get(key)?.id ?? null,
            entityType: "location",
            payload: {
              code,
              name: trimValue(record.name),
              locationType: trimValue(record.locationType),
              description: normalizeOptional(record.description),
              isActive: parseBooleanValue(record.isActive),
            },
          });
          break;
        }
        case "department": {
          const code = trimValue(record.code).toUpperCase();
          const key = normalizeKey(code);
          if (!key) {
            throw new Error("Department code is required.");
          }
          if (!trimValue(record.name)) {
            throw new Error("Department name is required.");
          }
          if (seenKeys.has(key)) {
            throw new Error(`Duplicate department code ${code} inside the CSV.`);
          }
          seenKeys.add(key);
          operations.push({
            rowNumber,
            key,
            existingId: existingByKey.get(key)?.id ?? null,
            entityType: "department",
            payload: {
              code,
              name: trimValue(record.name),
              description: normalizeOptional(record.description),
              isActive: parseBooleanValue(record.isActive),
            },
          });
          break;
        }
        case "crew": {
          const fullName = trimValue(record.fullName);
          const key = normalizeKey(fullName);
          const departmentLookupKey = normalizeKey(record.primaryDepartmentCode ?? "");
          const primaryDepartmentId = trimValue(record.primaryDepartmentCode)
            ? (departmentIdByLookup?.get(departmentLookupKey) ?? null)
            : null;
          if (!key) {
            throw new Error("Crew fullName is required.");
          }
          if (seenKeys.has(key)) {
            throw new Error(`Duplicate crew fullName ${fullName} inside the CSV.`);
          }
          if (trimValue(record.primaryDepartmentCode) && !primaryDepartmentId) {
            throw new Error(`Department ${trimValue(record.primaryDepartmentCode)} was not found for this workspace.`);
          }
          seenKeys.add(key);
          operations.push({
            rowNumber,
            key,
            existingId: existingByKey.get(key)?.id ?? null,
            entityType: "crew",
            payload: {
              fullName,
              primaryDepartmentId,
              documentId: normalizeOptional(record.documentId),
              roleLabel: normalizeOptional(record.roleLabel),
              email: normalizeOptional(record.email),
              phone: normalizeOptional(record.phone),
              notes: normalizeOptional(record.notes),
              bankAccounts: parseCrewBankAccounts(record.bankAccounts),
              isActive: parseBooleanValue(record.isActive),
            },
          });
          break;
        }
        case "client":
        case "production_company": {
          const name = trimValue(record.name);
          const key = normalizeKey(name);
          if (!key) {
            throw new Error(`${input.entityType === "client" ? "Client" : "Production company"} name is required.`);
          }
          if (seenKeys.has(key)) {
            throw new Error(`Duplicate ${input.entityType === "client" ? "client" : "production company"} name ${name} inside the CSV.`);
          }
          seenKeys.add(key);
          operations.push({
            rowNumber,
            key,
            existingId: existingByKey.get(key)?.id ?? null,
            entityType: input.entityType,
            payload: {
              name,
              contactName: normalizeOptional(record.contactName),
              email: normalizeOptional(record.email),
              phone: normalizeOptional(record.phone),
              notes: normalizeOptional(record.notes),
              isActive: parseBooleanValue(record.isActive),
            },
          });
          break;
        }
        case "manufacturer": {
          const name = trimValue(record.name);
          const key = normalizeKey(name);
          if (!key) {
            throw new Error("Manufacturer name is required.");
          }
          if (seenKeys.has(key)) {
            throw new Error(`Duplicate manufacturer name ${name} inside the CSV.`);
          }
          seenKeys.add(key);
          operations.push({
            rowNumber,
            key,
            existingId: existingByKey.get(key)?.id ?? null,
            entityType: "manufacturer",
            payload: {
              name,
              contactName: normalizeOptional(record.contactName),
              supportEmail: normalizeOptional(record.supportEmail),
              phone: normalizeOptional(record.phone),
              notes: normalizeOptional(record.notes),
              isActive: parseBooleanValue(record.isActive),
            },
          });
          break;
        }
        case "category": {
          const code = trimValue(record.code).toUpperCase();
          const key = normalizeKey(code);
          if (!key) {
            throw new Error("Category code is required.");
          }
          if (!trimValue(record.name)) {
            throw new Error("Category name is required.");
          }
          if (seenKeys.has(key)) {
            throw new Error(`Duplicate category code ${code} inside the CSV.`);
          }
          seenKeys.add(key);
          operations.push({
            rowNumber,
            key,
            existingId: existingByKey.get(key)?.id ?? null,
            entityType: "category",
            payload: {
              code,
              name: trimValue(record.name),
              description: normalizeOptional(record.description),
              isActive: parseBooleanValue(record.isActive),
            },
          });
          break;
        }
        case "kit": {
          const code = trimValue(record.code).toUpperCase();
          const key = normalizeKey(code);
          if (!key) {
            throw new Error("Kit code is required.");
          }
          if (!trimValue(record.name)) {
            throw new Error("Kit name is required.");
          }
          if (seenKeys.has(key)) {
            throw new Error(`Duplicate kit code ${code} inside the CSV.`);
          }
          seenKeys.add(key);
          const assetSelections = trimValue(record.assetQuantities)
            ? trimValue(record.assetQuantities)
                .split(";")
                .map((entry) => trimValue(entry))
                .filter(Boolean)
                .map((entry) => {
                  const [rawCode, rawQuantity] = entry.split(":");
                  const assetCode = trimValue(rawCode);
                  const quantity = Number.parseInt(trimValue(rawQuantity || "1"), 10);

                  if (!assetCode) {
                    throw new Error("Each asset quantity entry requires an asset code.");
                  }

                  if (!Number.isInteger(quantity) || quantity < 1) {
                    throw new Error(`Asset ${assetCode} must use a positive integer quantity.`);
                  }

                  const assetId = assetIdByCode?.get(normalizeKey(assetCode));
                  if (!assetId) {
                    throw new Error(`Asset code ${assetCode} was not found for this workspace.`);
                  }

                  return { assetId, quantity };
                })
            : [];
          operations.push({
            rowNumber,
            key,
            existingId: existingByKey.get(key)?.id ?? null,
            entityType: "kit",
            payload: {
              code,
              name: trimValue(record.name),
              description: normalizeOptional(record.description),
              notes: normalizeOptional(record.notes),
              assetSelections,
              isActive: parseBooleanValue(record.isActive),
            },
          });
          break;
        }
      }
    } catch (error) {
      errors.push({
        rowNumber,
        message: error instanceof Error ? error.message : "The row could not be parsed.",
        key: trimValue(record.code || record.name || record.fullName) || null,
      });
    }
  });

  operations.forEach((operation) => {
    if (operation.existingId) {
      updated += 1;
    } else {
      created += 1;
    }
  });

  const missingActiveIds =
    input.strategy === "replace"
      ? existingRows.filter((row) => row.isActive && !seenKeys.has(row.key)).map((row) => row.id)
      : [];

  return {
    entityType: input.entityType,
    strategy: input.strategy,
    totalRows: dataRows.length,
    created,
    updated,
    deactivated: missingActiveIds.length,
    skipped,
    invalid: errors.length,
    errors,
    rows: operations,
    missingActiveIds,
  };
};

const buildPreview = (analysis: ImportAnalysis): CatalogCsvImportPreview => ({
  entityType: analysis.entityType,
  strategy: analysis.strategy,
  totalRows: analysis.totalRows,
  created: analysis.created,
  updated: analysis.updated,
  deactivated: analysis.deactivated,
  skipped: analysis.skipped,
  invalid: analysis.invalid,
  errors: analysis.errors,
});

const replaceCrewBankAccounts = (
  db: DatabaseSync,
  crewMemberId: string,
  bankAccounts: Array<{
    bankName?: string;
    accountHolder?: string;
    accountNumber: string;
    accountType?: string;
    routingNumber?: string;
    notes?: string;
    maskInPreview?: boolean;
  }>,
  now: string,
) => {
  db.prepare("DELETE FROM crew_bank_accounts WHERE crew_member_id = ?").run(crewMemberId);

  bankAccounts.forEach((entry, index) => {
    db.prepare(
      `
        INSERT INTO crew_bank_accounts (
          id,
          crew_member_id,
          bank_name,
          account_holder,
          account_number,
          account_type,
          routing_number,
          notes,
          mask_in_preview,
          sort_order,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      `crew-bank-account-${crewMemberId}-${index}-${Date.now().toString(36)}`,
      crewMemberId,
      entry.bankName ?? null,
      entry.accountHolder ?? null,
      entry.accountNumber,
      entry.accountType ?? null,
      entry.routingNumber ?? null,
      entry.notes ?? null,
      entry.maskInPreview === false ? 0 : 1,
      index,
      now,
      now,
    );
  });
};

const runImportRow = (
  db: DatabaseSync,
  codeService: CodeGenerationService,
  row: ImportAnalysisRow,
  now: string,
) => {
  switch (row.entityType) {
    case "location": {
      if (row.existingId) {
        db.prepare(
          `
            UPDATE locations
            SET code = ?, name = ?, type = ?, description = ?, is_active = ?
            WHERE id = ?
          `,
        ).run(row.payload.code, row.payload.name, row.payload.locationType, row.payload.description, row.payload.isActive ? 1 : 0, row.existingId);
        return;
      }

      db.prepare(
        `
          INSERT INTO locations (id, workspace_id, code, name, type, description, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        `location-${slugify(row.payload.code)}-${Date.now().toString(36)}-${row.rowNumber}`,
        workspaceId,
        row.payload.code,
        row.payload.name,
        row.payload.locationType,
        row.payload.description,
        row.payload.isActive ? 1 : 0,
        now,
      );
      return;
    }
    case "department": {
      if (row.existingId) {
        db.prepare(
          `
            UPDATE departments
            SET code = ?, name = ?, description = ?, is_active = ?
            WHERE id = ?
          `,
        ).run(row.payload.code, row.payload.name, row.payload.description, row.payload.isActive ? 1 : 0, row.existingId);
        return;
      }

      db.prepare(
        `
          INSERT INTO departments (id, workspace_id, code, name, description, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        `department-${slugify(row.payload.code)}-${Date.now().toString(36)}-${row.rowNumber}`,
        workspaceId,
        row.payload.code,
        row.payload.name,
        row.payload.description,
        row.payload.isActive ? 1 : 0,
        now,
      );
      return;
    }
    case "crew": {
      if (row.existingId) {
        db.prepare(
          `
            UPDATE crew_members
            SET full_name = ?, primary_department_id = ?, document_id = ?, role_label = ?, email = ?, phone = ?, notes = ?, is_active = ?, updated_at = ?
            WHERE id = ?
          `,
        ).run(
          row.payload.fullName,
          row.payload.primaryDepartmentId,
          row.payload.documentId,
          row.payload.roleLabel,
          row.payload.email,
          row.payload.phone,
          row.payload.notes,
          row.payload.isActive ? 1 : 0,
          now,
          row.existingId,
        );
        replaceCrewBankAccounts(db, row.existingId, row.payload.bankAccounts, now);
        return;
      }

      const crewId = `crew-${slugify(row.payload.fullName)}-${Date.now().toString(36)}-${row.rowNumber}`;
      db.prepare(
        `
          INSERT INTO crew_members (
            id, workspace_id, full_name, primary_department_id, document_id, role_label, email, phone, notes, is_active, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        crewId,
        workspaceId,
        row.payload.fullName,
        row.payload.primaryDepartmentId,
        row.payload.documentId,
        row.payload.roleLabel,
        row.payload.email,
        row.payload.phone,
        row.payload.notes,
        row.payload.isActive ? 1 : 0,
        now,
        now,
      );
      replaceCrewBankAccounts(db, crewId, row.payload.bankAccounts, now);
      return;
    }
    case "client": {
      if (row.existingId) {
        db.prepare(
          `
            UPDATE clients
            SET name = ?, contact_name = ?, email = ?, phone = ?, notes = ?, is_active = ?, updated_at = ?
            WHERE id = ?
          `,
        ).run(
          row.payload.name,
          row.payload.contactName,
          row.payload.email,
          row.payload.phone,
          row.payload.notes,
          row.payload.isActive ? 1 : 0,
          now,
          row.existingId,
        );
        db.prepare("UPDATE projects SET client_name = ? WHERE client_id = ?").run(row.payload.name, row.existingId);
        return;
      }

      db.prepare(
        `
          INSERT INTO clients (id, workspace_id, name, contact_name, email, phone, notes, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        `client-${slugify(row.payload.name)}-${Date.now().toString(36)}-${row.rowNumber}`,
        workspaceId,
        row.payload.name,
        row.payload.contactName,
        row.payload.email,
        row.payload.phone,
        row.payload.notes,
        row.payload.isActive ? 1 : 0,
        now,
        now,
      );
      return;
    }
    case "production_company": {
      if (row.existingId) {
        db.prepare(
          `
            UPDATE production_companies
            SET name = ?, contact_name = ?, email = ?, phone = ?, notes = ?, is_active = ?, updated_at = ?
            WHERE id = ?
          `,
        ).run(
          row.payload.name,
          row.payload.contactName,
          row.payload.email,
          row.payload.phone,
          row.payload.notes,
          row.payload.isActive ? 1 : 0,
          now,
          row.existingId,
        );
        db.prepare("UPDATE projects SET production_company_name = ? WHERE production_company_id = ?").run(row.payload.name, row.existingId);
        return;
      }

      db.prepare(
        `
          INSERT INTO production_companies (id, workspace_id, name, contact_name, email, phone, notes, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        `production-company-${slugify(row.payload.name)}-${Date.now().toString(36)}-${row.rowNumber}`,
        workspaceId,
        row.payload.name,
        row.payload.contactName,
        row.payload.email,
        row.payload.phone,
        row.payload.notes,
        row.payload.isActive ? 1 : 0,
        now,
        now,
      );
      return;
    }
    case "manufacturer": {
      if (row.existingId) {
        db.prepare(
          `
            UPDATE manufacturers
            SET name = ?, contact_name = ?, support_email = ?, phone = ?, notes = ?, is_active = ?, updated_at = ?
            WHERE id = ?
          `,
        ).run(
          row.payload.name,
          row.payload.contactName,
          row.payload.supportEmail,
          row.payload.phone,
          row.payload.notes,
          row.payload.isActive ? 1 : 0,
          now,
          row.existingId,
        );
        db.prepare(
          "UPDATE rma_cases SET support_email = COALESCE(?, support_email) WHERE manufacturer_id = ? AND (support_email IS NULL OR trim(support_email) = '')",
        ).run(row.payload.supportEmail, row.existingId);
        return;
      }

      db.prepare(
        `
          INSERT INTO manufacturers (id, workspace_id, name, contact_name, support_email, phone, notes, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        `manufacturer-${slugify(row.payload.name)}-${Date.now().toString(36)}-${row.rowNumber}`,
        workspaceId,
        row.payload.name,
        row.payload.contactName,
        row.payload.supportEmail,
        row.payload.phone,
        row.payload.notes,
        row.payload.isActive ? 1 : 0,
        now,
        now,
      );
      return;
    }
    case "category": {
      if (row.existingId) {
        db.prepare(
          `
            UPDATE asset_categories
            SET code = ?, name = ?, description = ?, is_active = ?
            WHERE id = ?
          `,
        ).run(row.payload.code, row.payload.name, row.payload.description, row.payload.isActive ? 1 : 0, row.existingId);
        return;
      }

      db.prepare(
        `
          INSERT INTO asset_categories (id, workspace_id, parent_category_id, code, name, description, created_at, is_active)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
        `,
      ).run(
        `category-${slugify(row.payload.code)}-${Date.now().toString(36)}-${row.rowNumber}`,
        workspaceId,
        row.payload.code,
        row.payload.name,
        row.payload.description,
        now,
        row.payload.isActive ? 1 : 0,
      );
      return;
    }
    case "kit": {
      const kitId = row.existingId ?? `kit-${slugify(row.payload.code)}-${Date.now().toString(36)}-${row.rowNumber}`;
      if (row.existingId) {
        db.prepare(
          `
            UPDATE kits
            SET code = ?, name = ?, description = ?, notes = ?, is_active = ?, updated_at = ?
            WHERE id = ?
          `,
        ).run(
          row.payload.code,
          row.payload.name,
          row.payload.description,
          row.payload.notes,
          row.payload.isActive ? 1 : 0,
          now,
          row.existingId,
        );
      } else {
        db.prepare(
          `
            INSERT INTO kits (id, workspace_id, code, name, description, notes, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          kitId,
          workspaceId,
          row.payload.code,
          row.payload.name,
          row.payload.description,
          row.payload.notes,
          row.payload.isActive ? 1 : 0,
          now,
          now,
        );
      }

      db.prepare("DELETE FROM kit_assets WHERE kit_id = ?").run(kitId);
      const insertKitAsset = db.prepare("INSERT INTO kit_assets (kit_id, asset_id, quantity, added_at) VALUES (?, ?, ?, ?)");
      row.payload.assetSelections.forEach((selection) => {
        insertKitAsset.run(kitId, selection.assetId, selection.quantity, now);
      });
      codeService.ensurePrimaryCode({
        workspaceId,
        entityType: "kit",
        entityId: kitId,
        preferredCodeValue: `KIT-${row.payload.code}`,
      });
    }
  }
};

const deactivateMissingRows = (db: DatabaseSync, entityType: CatalogEntityType, ids: string[], now: string) => {
  if (!ids.length) {
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");

  switch (entityType) {
    case "location":
      db.prepare(`UPDATE locations SET is_active = 0 WHERE id IN (${placeholders})`).run(...ids);
      return;
    case "department":
      db.prepare(`UPDATE departments SET is_active = 0 WHERE id IN (${placeholders})`).run(...ids);
      return;
    case "crew":
      db.prepare(`UPDATE crew_members SET is_active = 0, updated_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);
      return;
    case "client":
      db.prepare(`UPDATE clients SET is_active = 0, updated_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);
      return;
    case "production_company":
      db.prepare(`UPDATE production_companies SET is_active = 0, updated_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);
      return;
    case "manufacturer":
      db.prepare(`UPDATE manufacturers SET is_active = 0, updated_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);
      return;
    case "category":
      db.prepare(`UPDATE asset_categories SET is_active = 0 WHERE id IN (${placeholders})`).run(...ids);
      return;
    case "kit":
      db.prepare(`UPDATE kits SET is_active = 0, updated_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);
      return;
  }
};

export const createCatalogCsvService = (db: DatabaseSync, codeService: CodeGenerationService) => ({
  buildExport(input: ExportCatalogCsvInput) {
    const headers = expectedHeadersByEntity[input.entityType];
    const idFilter = buildIdFilterClause(input.ids);
    if (input.mode === "template") {
      return {
        fileName: `${input.entityType}-template.csv`,
        csvText: serializeCsv(headers, []),
      };
    }

    let rows: Array<Record<string, string>> = [];

    switch (input.entityType) {
      case "location":
        rows = (db
          .prepare(
            `SELECT code, name, type, COALESCE(description, '') AS description, is_active FROM locations WHERE workspace_id = ?${idFilter.sql} ORDER BY name`,
          )
          .all(workspaceId, ...idFilter.params) as Array<{ code: string; name: string; type: string; description: string; is_active: number }>).map((row) => ({
          code: row.code,
          name: row.name,
          locationType: row.type,
          description: row.description,
          isActive: row.is_active ? "true" : "false",
        }));
        break;
      case "department":
        rows = (db
          .prepare(
            `SELECT code, name, COALESCE(description, '') AS description, is_active FROM departments WHERE workspace_id = ?${idFilter.sql} ORDER BY name`,
          )
          .all(workspaceId, ...idFilter.params) as Array<{ code: string; name: string; description: string; is_active: number }>).map((row) => ({
          code: row.code,
          name: row.name,
          description: row.description,
          isActive: row.is_active ? "true" : "false",
        }));
        break;
      case "crew":
        {
          const qualifiedIdFilterSql = idFilter.sql.replace(/\bid\b/g, "crew_members.id");
          const crewRows = db
            .prepare(
              `
                SELECT
                  crew_members.id,
                  crew_members.full_name,
                  COALESCE(departments.code, '') AS primary_department_code,
                  COALESCE(crew_members.document_id, '') AS document_id,
                  COALESCE(crew_members.role_label, '') AS role_label,
                  COALESCE(crew_members.email, '') AS email,
                  COALESCE(crew_members.phone, '') AS phone,
                  COALESCE(crew_members.notes, '') AS notes,
                  crew_members.is_active
                FROM crew_members
                LEFT JOIN departments ON departments.id = crew_members.primary_department_id
                WHERE crew_members.workspace_id = ?${qualifiedIdFilterSql}
                ORDER BY crew_members.full_name
              `,
            )
            .all(workspaceId, ...idFilter.params) as Array<{
            id: string;
            full_name: string;
            primary_department_code: string;
            document_id: string;
            role_label: string;
            email: string;
            phone: string;
            notes: string;
            is_active: number;
          }>;

          const bankAccountsByCrewId = new Map<string, Array<Record<string, unknown>>>();
          (db
            .prepare(
              `
                SELECT
                  crew_member_id,
                  COALESCE(bank_name, '') AS bank_name,
                  COALESCE(account_holder, '') AS account_holder,
                  account_number,
                  COALESCE(account_type, '') AS account_type,
                  COALESCE(routing_number, '') AS routing_number,
                  COALESCE(notes, '') AS notes,
                  mask_in_preview
                FROM crew_bank_accounts
                ORDER BY crew_member_id, sort_order, created_at
              `,
            )
            .all() as Array<{
            crew_member_id: string;
            bank_name: string;
            account_holder: string;
            account_number: string;
            account_type: string;
            routing_number: string;
            notes: string;
            mask_in_preview: number;
          }>).forEach((account) => {
            const current = bankAccountsByCrewId.get(account.crew_member_id) ?? [];
            const nextEntry = {
              bankName: account.bank_name,
              accountHolder: account.account_holder,
              accountNumber: account.account_number,
              accountType: account.account_type,
              routingNumber: account.routing_number,
              notes: account.notes,
              maskInPreview: Boolean(account.mask_in_preview),
            };
            bankAccountsByCrewId.set(account.crew_member_id, [...current, nextEntry]);
          });

          rows = crewRows.map((row) => ({
            fullName: row.full_name,
            primaryDepartmentCode: row.primary_department_code,
            documentId: row.document_id,
            roleLabel: row.role_label,
            email: row.email,
            phone: row.phone,
            notes: row.notes,
            bankAccounts: JSON.stringify(bankAccountsByCrewId.get(row.id) ?? []),
            isActive: row.is_active ? "true" : "false",
          }));
        }
        break;
      case "client":
        rows = (db
          .prepare(
            `SELECT name, COALESCE(contact_name, '') AS contact_name, COALESCE(email, '') AS email, COALESCE(phone, '') AS phone, COALESCE(notes, '') AS notes, is_active FROM clients WHERE workspace_id = ?${idFilter.sql} ORDER BY name`,
          )
          .all(workspaceId, ...idFilter.params) as Array<{ name: string; contact_name: string; email: string; phone: string; notes: string; is_active: number }>).map((row) => ({
          name: row.name,
          contactName: row.contact_name,
          email: row.email,
          phone: row.phone,
          notes: row.notes,
          isActive: row.is_active ? "true" : "false",
        }));
        break;
      case "production_company":
        rows = (db
          .prepare(
            `SELECT name, COALESCE(contact_name, '') AS contact_name, COALESCE(email, '') AS email, COALESCE(phone, '') AS phone, COALESCE(notes, '') AS notes, is_active FROM production_companies WHERE workspace_id = ?${idFilter.sql} ORDER BY name`,
          )
          .all(workspaceId, ...idFilter.params) as Array<{ name: string; contact_name: string; email: string; phone: string; notes: string; is_active: number }>).map((row) => ({
          name: row.name,
          contactName: row.contact_name,
          email: row.email,
          phone: row.phone,
          notes: row.notes,
          isActive: row.is_active ? "true" : "false",
        }));
        break;
      case "manufacturer":
        rows = (db
          .prepare(
            `SELECT name, COALESCE(contact_name, '') AS contact_name, COALESCE(support_email, '') AS support_email, COALESCE(phone, '') AS phone, COALESCE(notes, '') AS notes, is_active FROM manufacturers WHERE workspace_id = ?${idFilter.sql} ORDER BY name`,
          )
          .all(workspaceId, ...idFilter.params) as Array<{ name: string; contact_name: string; support_email: string; phone: string; notes: string; is_active: number }>).map((row) => ({
          name: row.name,
          contactName: row.contact_name,
          supportEmail: row.support_email,
          phone: row.phone,
          notes: row.notes,
          isActive: row.is_active ? "true" : "false",
        }));
        break;
      case "category":
        rows = (db
          .prepare(
            `SELECT code, name, COALESCE(description, '') AS description, COALESCE(is_active, 1) AS is_active FROM asset_categories WHERE workspace_id = ?${idFilter.sql} ORDER BY name`,
          )
          .all(workspaceId, ...idFilter.params) as Array<{ code: string; name: string; description: string; is_active: number }>).map((row) => ({
          code: row.code,
          name: row.name,
          description: row.description,
          isActive: row.is_active ? "true" : "false",
        }));
        break;
      case "kit":
        rows = (db
          .prepare(
            `
              SELECT
                kits.code,
                kits.name,
                COALESCE(kits.description, '') AS description,
                COALESCE(kits.notes, '') AS notes,
                COALESCE(kits.is_active, 1) AS is_active,
                COALESCE((
                  SELECT group_concat(asset_entry, ';')
                  FROM (
                    SELECT printf('%s:%d', COALESCE(legacy_rentman_items.legacy_code, assets.internal_code), COALESCE(kit_assets.quantity, 1)) AS asset_entry
                    FROM kit_assets
                    JOIN assets ON assets.id = kit_assets.asset_id
                    LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
                    LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
                    WHERE kit_assets.kit_id = kits.id
                    ORDER BY asset_entry
                  )
                ), '') AS asset_quantities
              FROM kits
              WHERE kits.workspace_id = ?
                ${idFilter.sql ? idFilter.sql.replace(/^ AND /u, "AND ") : ""}
              ORDER BY kits.name
            `,
          )
          .all(workspaceId, ...idFilter.params) as Array<{ code: string; name: string; description: string; notes: string; asset_quantities: string; is_active: number }>).map((row) => ({
          code: row.code,
          name: row.name,
          description: row.description,
          notes: row.notes,
          assetQuantities: row.asset_quantities,
          isActive: row.is_active ? "true" : "false",
        }));
        break;
    }

    return {
      fileName: `${input.entityType}.csv`,
      csvText: serializeCsv(headers, rows),
    };
  },

  previewImport(input: PreviewCatalogCsvImportInput): CatalogCsvImportPreview {
    return buildPreview(analyzeImport(db, input));
  },

  importCsv(input: ImportCatalogCsvInput): CatalogCsvImportResult {
    const analysis = analyzeImport(db, input);
    if (analysis.invalid > 0) {
      const firstError = analysis.errors[0];
      throw new Error(firstError ? `Import blocked at row ${firstError.rowNumber}: ${firstError.message}` : "Import blocked due to invalid rows.");
    }

    const now = new Date().toISOString();
    db.exec("BEGIN");

    try {
      analysis.rows.forEach((row) => {
        runImportRow(db, codeService, row, now);
      });
      if (input.strategy === "replace") {
        deactivateMissingRows(db, input.entityType, analysis.missingActiveIds, now);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const summaryParts = [];
    if (analysis.created) {
      summaryParts.push(`${analysis.created} created`);
    }
    if (analysis.updated) {
      summaryParts.push(`${analysis.updated} updated`);
    }
    if (analysis.deactivated) {
      summaryParts.push(`${analysis.deactivated} deactivated`);
    }
    if (analysis.skipped) {
      summaryParts.push(`${analysis.skipped} skipped`);
    }

    return {
      ...buildPreview(analysis),
      summary: summaryParts.length
        ? `Imported ${input.entityType} CSV: ${summaryParts.join(", ")}.`
        : `No ${input.entityType} rows changed.`,
    };
  },
});

export type CatalogCsvService = ReturnType<typeof createCatalogCsvService>;
