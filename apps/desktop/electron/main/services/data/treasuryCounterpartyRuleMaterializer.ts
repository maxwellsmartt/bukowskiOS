import type { DatabaseSync } from "node:sqlite";

type CounterpartyRuleRow = {
  id: string;
  workspace_id: string;
  match_pattern: string | null;
  match_type: string | null;
  default_kind: string | null;
  default_category: string | null;
  default_counterparty: string | null;
  is_active: number | boolean;
  updated_at: string | null;
};

export type TreasuryCounterpartyRuleMaterializerResult = {
  rulesScanned: number;
  annotationsApplied: number;
};

const normalizeRuleText = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();

const hasActionableDefault = (rule: CounterpartyRuleRow) =>
  Boolean(rule.default_kind || rule.default_category || rule.default_counterparty);

export const materializeTreasuryCounterpartyRules = (
  db: DatabaseSync,
  workspaceId?: string,
): TreasuryCounterpartyRuleMaterializerResult => {
  const params: string[] = [];
  let workspaceFilter = "";
  if (workspaceId) {
    workspaceFilter = "AND workspace_id = ?";
    params.push(workspaceId);
  }

  const rules = db
    .prepare(
      `
        SELECT id, workspace_id, match_pattern, match_type, default_kind,
               default_category, default_counterparty, is_active, updated_at
        FROM counterparty_rules
        WHERE is_active = 1
          ${workspaceFilter}
        ORDER BY priority DESC, updated_at DESC
      `,
    )
    .all(...params) as CounterpartyRuleRow[];

  if (!rules.length) return { rulesScanned: 0, annotationsApplied: 0 };

  const findMatches = db.prepare(
    `
      SELECT t.id
      FROM bank_transactions t
      LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
      WHERE t.workspace_id = ?
        AND t.raw_description IS NOT NULL
        AND (
          (? = 'contains' AND UPPER(t.raw_description) LIKE ?)
          OR (? != 'contains' AND UPPER(TRIM(t.raw_description)) = ?)
        )
        AND (a.transaction_id IS NULL OR a.txn_kind IS NULL)
    `,
  );
  const upsertAnnotation = db.prepare(
    `
      INSERT INTO transaction_annotations (
        transaction_id, workspace_id, txn_kind, concept, counterparty,
        counterparty_rnc, expense_category, is_internal_transfer,
        reimbursement_status, classified_by_user_id, updated_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, 'n/a', NULL, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET
        txn_kind = excluded.txn_kind,
        counterparty = COALESCE(excluded.counterparty, transaction_annotations.counterparty),
        expense_category = COALESCE(excluded.expense_category, transaction_annotations.expense_category),
        is_internal_transfer = excluded.is_internal_transfer,
        reimbursement_status = COALESCE(transaction_annotations.reimbursement_status, excluded.reimbursement_status),
        classified_by_user_id = COALESCE(transaction_annotations.classified_by_user_id, excluded.classified_by_user_id),
        updated_at = excluded.updated_at
      WHERE transaction_annotations.txn_kind IS NULL
    `,
  );

  let annotationsApplied = 0;
  for (const rule of rules) {
    const pattern = rule.match_pattern?.trim();
    if (!pattern || !hasActionableDefault(rule)) continue;

    const matchType = rule.match_type === "contains" ? "contains" : "exact";
    const normalizedPattern = normalizeRuleText(pattern);
    const likePattern = `%${normalizedPattern}%`;
    const matches = findMatches.all(
      rule.workspace_id,
      matchType,
      likePattern,
      matchType,
      normalizedPattern,
    ) as Array<{ id: string }>;

    const isInternalTransfer = rule.default_kind === "transfer" || rule.default_kind === "fx_exchange" ? 1 : 0;
    const updatedAt = rule.updated_at ?? new Date().toISOString();
    for (const match of matches) {
      const result = upsertAnnotation.run(
        match.id,
        rule.workspace_id,
        rule.default_kind,
        rule.default_counterparty,
        rule.default_category,
        isInternalTransfer,
        updatedAt,
      );
      annotationsApplied += Number(result.changes ?? 0);
    }
  }

  return { rulesScanned: rules.length, annotationsApplied };
};
