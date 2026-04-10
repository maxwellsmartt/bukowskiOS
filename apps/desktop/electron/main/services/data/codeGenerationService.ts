import type { DatabaseSync } from "node:sqlite";

import bwipjs from "bwip-js";
import QRCode from "qrcode";

type ScannableEntityType = "asset" | "packing_slip" | "kit";
type ScannableSymbology = "qr" | "code128";

export type ScannableCodeRecord = {
  id: string;
  entityType: ScannableEntityType;
  entityId: string;
  symbology: ScannableSymbology;
  codeValue: string;
  isPrimary: boolean;
};

type EnsurePrimaryCodeInput = {
  workspaceId: string;
  entityType: ScannableEntityType;
  entityId: string;
  preferredCodeValue: string;
  symbology?: ScannableSymbology;
};

const normalizeCodeSegment = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();

const ensureUniqueCodeValue = (db: DatabaseSync, workspaceId: string, entityId: string, preferredCodeValue: string) => {
  const baseCodeValue = normalizeCodeSegment(preferredCodeValue) || `CODE-${entityId.toUpperCase()}`;
  let candidate = baseCodeValue;
  let suffix = 2;

  while (true) {
    const existing = db
      .prepare(
        `
          SELECT entity_id
          FROM scannable_codes
          WHERE workspace_id = ?
            AND code_value = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, candidate) as { entity_id: string } | undefined;

    if (!existing || existing.entity_id === entityId) {
      return candidate;
    }

    candidate = `${baseCodeValue}-${suffix}`;
    suffix += 1;
  }
};

export const createCodeGenerationService = (db: DatabaseSync) => ({
  ensurePrimaryCode(input: EnsurePrimaryCodeInput): ScannableCodeRecord {
    const symbology = input.symbology ?? "qr";
    const existing = db
      .prepare(
        `
          SELECT id, entity_type, entity_id, symbology, code_value, is_primary
          FROM scannable_codes
          WHERE workspace_id = ?
            AND entity_type = ?
            AND entity_id = ?
            AND is_primary = 1
          LIMIT 1
        `,
      )
      .get(input.workspaceId, input.entityType, input.entityId) as
      | {
          id: string;
          entity_type: ScannableEntityType;
          entity_id: string;
          symbology: ScannableSymbology;
          code_value: string;
          is_primary: number;
        }
      | undefined;

    const codeValue = ensureUniqueCodeValue(db, input.workspaceId, input.entityId, input.preferredCodeValue);
    const now = new Date().toISOString();

    if (existing) {
      db.prepare(
        `
          UPDATE scannable_codes
          SET symbology = ?, code_value = ?, is_primary = 1
          WHERE id = ?
        `,
      ).run(symbology, codeValue, existing.id);

      return {
        id: existing.id,
        entityType: existing.entity_type,
        entityId: existing.entity_id,
        symbology,
        codeValue,
        isPrimary: true,
      };
    }

    const codeId = `code-${input.entityType}-${input.entityId}`;

    db.prepare(
      `
        INSERT INTO scannable_codes (
          id,
          workspace_id,
          entity_type,
          entity_id,
          symbology,
          code_value,
          is_primary,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `,
    ).run(codeId, input.workspaceId, input.entityType, input.entityId, symbology, codeValue, now);

    return {
      id: codeId,
      entityType: input.entityType,
      entityId: input.entityId,
      symbology,
      codeValue,
      isPrimary: true,
    };
  },

  getPrimaryCode(entityType: ScannableEntityType, entityId: string) {
    const row = db
      .prepare(
        `
          SELECT id, entity_type, entity_id, symbology, code_value, is_primary
          FROM scannable_codes
          WHERE entity_type = ?
            AND entity_id = ?
            AND is_primary = 1
          LIMIT 1
        `,
      )
      .get(entityType, entityId) as
      | {
          id: string;
          entity_type: ScannableEntityType;
          entity_id: string;
          symbology: ScannableSymbology;
          code_value: string;
          is_primary: number;
        }
      | undefined;

    return row
      ? {
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          symbology: row.symbology,
          codeValue: row.code_value,
          isPrimary: Boolean(row.is_primary),
        }
      : null;
  },

  listCodes(entityType: ScannableEntityType, entityId: string): ScannableCodeRecord[] {
    const rows = db
      .prepare(
        `
          SELECT id, entity_type, entity_id, symbology, code_value, is_primary
          FROM scannable_codes
          WHERE entity_type = ?
            AND entity_id = ?
          ORDER BY is_primary DESC, created_at ASC
        `,
      )
      .all(entityType, entityId) as Array<{
      id: string;
      entity_type: ScannableEntityType;
      entity_id: string;
      symbology: ScannableSymbology;
      code_value: string;
      is_primary: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      symbology: row.symbology,
      codeValue: row.code_value,
      isPrimary: Boolean(row.is_primary),
    }));
  },

  generateQrDataUrl: async (codeValue: string) => QRCode.toDataURL(codeValue, { margin: 0, width: 256 }),

  generateBarcodeBuffer: async (codeValue: string) =>
    bwipjs.toBuffer({
      bcid: "code128",
      text: codeValue,
      scale: 3,
      height: 10,
      includetext: false,
    }),
});

export type CodeGenerationService = ReturnType<typeof createCodeGenerationService>;
