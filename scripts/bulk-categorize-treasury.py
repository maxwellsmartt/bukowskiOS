#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_DB = "/Users/ernestomaxwell/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite"
DEFAULT_BACKUP = "/private/tmp/bukowski-foundation-before-treasury-bulk-categorize.sqlite"

OWN_ACCOUNT_REFS = {
    "0000788565075",
    "0000819426362",
    "0114320100030",
    "0214320200004",
}

HONORARIO_REFS = {
    "0000736440025",
    "0000787361427",
    "0000790385785",
    "0000818479339",
    "0000825110224",
    "0000803384106",
    "0000818632473",
    "0000786469585",
    "0000788840684",
    "0400258201183",
    "0100020350275",
    "0009600426427",
    "0001027204155",
    "0086209609500",
    "0419181001110",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def norm(value: Any) -> str:
    return "" if value is None else str(value).strip()


def upper_text(row: sqlite3.Row) -> str:
    return " ".join(
        [
            norm(row["raw_description"]),
            norm(row["reference"]),
            norm(row["serial"]),
        ]
    ).upper()


def ref(row: sqlite3.Row) -> str:
    return norm(row["serial"]) or norm(row["reference"])


def classify(row: sqlite3.Row) -> tuple[str, str | None, int, str]:
    text = upper_text(row)
    reference = ref(row)
    direction = norm(row["direction"])

    if reference in OWN_ACCOUNT_REFS or (
        "METADATA CINE" in text and ("114320100030" in text or "214320200004" in text)
    ):
        return ("fx_exchange" if row["currency"] == "USD" else "transfer", "internal_transfer", 1, "own_account")

    if "PAGO INTERESES" in text or "CAPITALIZACION DE INTERESES" in text or "COMPENSACION POR BALANCE" in text:
        return ("interest", "interest_income", 0, "interest")

    if direction == "credit":
        return ("income", "production_income", 0, "credit_income")

    if any(token in text for token in ["TSS", "TESORERIA SEGURIDAD SOCIAL"]):
        return ("tss", "social_security", 0, "tss")

    if any(token in text for token in [" DGII", "DGA", "IMPUESTO", "IMP. 1.5", "DESC. 1%", "LEY 288-04"]):
        return ("tax", "taxes", 0, "tax")

    if any(token in text for token in ["COMISION", "COMISIONES", "CARGO POR SERVICIO", "CARGO SERVICIO"]):
        return ("bank_fee", "bank_fees", 0, "bank_fee")

    if "PRESTAMO" in text or "CRÉDITO" in text or "CREDITO #" in text:
        return ("expense", "loan_financing", 0, "loan")

    if "PAGO TARJETA" in text or "IB TC" in text:
        return ("expense", "credit_card", 0, "credit_card")

    if reference in HONORARIO_REFS:
        return ("expense", "crew_fees", 0, "recurring_payee")

    if any(token in text for token in ["SETUP TECH", "MAGUA MEDIA", "EDDY GUZMAN", "DEBITO POR TRANSFERENCIA"]):
        return ("expense", "services", 0, "service_vendor")

    if any(token in text for token in ["CHEQUE PAGADO", "PAGO DE CHEQUE"]):
        return ("expense", "other_expenses", 0, "check_payment")

    return ("expense", "other_expenses", 0, "fallback_expense")


def enqueue(conn: sqlite3.Connection, workspace_id: str, txn_id: str, timestamp: str) -> None:
    conn.execute(
        """
        insert or replace into sync_outbox (
          id, workspace_id, entity_type, entity_id, operation_type,
          payload_json, status, attempt_count, last_error, next_retry_at,
          created_at, updated_at
        ) values (?, ?, 'transaction_annotation', ?, 'upsert', ?, 'pending', 0, null, ?, ?, ?)
        """,
        (
            f"sync-bulk-category-{txn_id}",
            workspace_id,
            txn_id,
            json.dumps({"source": "treasury_bulk_categorize_t2"}),
            timestamp,
            timestamp,
            timestamp,
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply T2 bulk categorization to treasury transactions.")
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--backup", default=DEFAULT_BACKUP)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    db = Path(args.db)
    backup = Path(args.backup)
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")

    rows = conn.execute(
        """
        select t.*, a.txn_kind, a.expense_category, a.is_internal_transfer
        from bank_transactions t
        left join transaction_annotations a on a.transaction_id = t.id
        order by t.txn_date, t.id
        """
    ).fetchall()

    changes: list[dict[str, Any]] = []
    reason_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()
    for row in rows:
        kind, category, is_internal, reason = classify(row)
        current_kind = norm(row["txn_kind"])
        current_category = norm(row["expense_category"])
        current_internal = int(row["is_internal_transfer"] or 0)

        if current_kind == kind and current_category == (category or "") and current_internal == is_internal:
            continue
        changes.append(
            {
                "transaction_id": row["id"],
                "date": row["txn_date"],
                "amount": row["amount"],
                "currency": row["currency"],
                "description": row["raw_description"],
                "from": {"kind": current_kind or None, "category": current_category or None, "internal": current_internal},
                "to": {"kind": kind, "category": category, "internal": is_internal},
                "reason": reason,
            }
        )
        reason_counts[reason] += 1
        category_counts[category or kind] += 1

    print(
        json.dumps(
            {
                "backup": str(backup),
                "candidate_changes": len(changes),
                "by_reason": dict(reason_counts.most_common()),
                "by_category": dict(category_counts.most_common()),
                "sample": changes[:20],
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    if not args.apply:
        print("dry_run=true")
        return 0

    shutil.copy2(db, backup)
    timestamp = now_iso()
    with conn:
        for change in changes:
            conn.execute(
                """
                insert into transaction_annotations (
                  transaction_id, workspace_id, txn_kind, expense_category,
                  is_internal_transfer, reimbursement_status, fiscal_status, notes, updated_at
                ) values (?, (select workspace_id from bank_transactions where id = ?), ?, ?, ?, 'n/a', 'pending', ?, ?)
                on conflict(transaction_id) do update set
                  txn_kind = excluded.txn_kind,
                  expense_category = excluded.expense_category,
                  is_internal_transfer = excluded.is_internal_transfer,
                  notes = case
                    when transaction_annotations.notes is null or transaction_annotations.notes = ''
                    then excluded.notes
                    else transaction_annotations.notes
                  end,
                  updated_at = excluded.updated_at
                """,
                (
                    change["transaction_id"],
                    change["transaction_id"],
                    change["to"]["kind"],
                    change["to"]["category"],
                    change["to"]["internal"],
                    f"T2 bulk categorization: {change['reason']}",
                    timestamp,
                ),
            )
            workspace_id = conn.execute(
                "select workspace_id from bank_transactions where id = ?",
                (change["transaction_id"],),
            ).fetchone()[0]
            enqueue(conn, workspace_id, change["transaction_id"], timestamp)

    print("applied=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
