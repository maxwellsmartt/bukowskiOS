import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { applyTreasuryFoundationSelfHeal } from "../../electron/main/services/data/treasuryFoundationBootstrap";

const createLegacyDatabase = () => {
  const databasePath = path.join(os.tmpdir(), `treasury-bootstrap-${Date.now()}-${Math.random()}.sqlite`);
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE transaction_annotations (
      transaction_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      txn_kind TEXT,
      counterparty TEXT,
      expense_category TEXT,
      is_internal_transfer INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  return {
    database,
    cleanup: () => {
      database.close();
      fs.unlinkSync(databasePath);
    },
  };
};

describe("treasury foundation bootstrap", () => {
  it("self-heals legacy treasury schemas without dropping local data", () => {
    const { cleanup, database } = createLegacyDatabase();
    database
      .prepare(
        `
          INSERT INTO transaction_annotations (
            transaction_id, workspace_id, txn_kind, counterparty,
            expense_category, is_internal_transfer, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?)
        `,
      )
      .run("txn-1", "workspace-1", "expense", "Supplier A", "Servicios", "2026-05-25T12:00:00.000Z");

    applyTreasuryFoundationSelfHeal(database);
    applyTreasuryFoundationSelfHeal(database);

    const fiscalColumns = new Set(
      (database.prepare("PRAGMA table_info(transaction_annotations)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    expect(fiscalColumns.has("supplier_ncf")).toBe(true);
    expect(fiscalColumns.has("dgii_expense_type")).toBe(true);
    expect(fiscalColumns.has("withholding_type")).toBe(true);
    expect(fiscalColumns.has("withholding_rate")).toBe(true);
    expect(fiscalColumns.has("withholding_amount")).toBe(true);
    expect(fiscalColumns.has("fiscal_period")).toBe(true);

    const annotation = database
      .prepare("SELECT txn_kind, counterparty, expense_category FROM transaction_annotations WHERE transaction_id = ?")
      .get("txn-1") as { txn_kind: string; counterparty: string; expense_category: string };
    expect(annotation).toEqual({
      txn_kind: "expense",
      counterparty: "Supplier A",
      expense_category: "Servicios",
    });

    const undoTable = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'treasury_undo_journal'")
      .get() as { name: string } | undefined;
    expect(undoTable?.name).toBe("treasury_undo_journal");

    cleanup();
  });
});
