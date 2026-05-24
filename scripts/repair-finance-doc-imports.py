#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def round2(value: float) -> float:
    return round(float(value) + 1e-12, 2)


def dedupe_hash(account_id: str, row: sqlite3.Row, currency: str) -> str:
    parts = [
        account_id,
        row["txn_date"],
        f"{round2(row['amount']):.2f}",
        row["direction"],
        (row["raw_description"] or "").strip(),
        "" if row["running_balance"] is None else f"{round2(row['running_balance']):.2f}",
        (row["reference"] or "").strip(),
        (row["serial"] or "").strip(),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def fetch_one_id(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> str:
    row = conn.execute(sql, params).fetchone()
    if not row:
        raise RuntimeError(f"Expected row for query: {sql} {params}")
    return str(row[0])


def enqueue(conn: sqlite3.Connection, outbox_id: str, workspace_id: str, entity_type: str, entity_id: str) -> None:
    ts = now_iso()
    conn.execute(
        """
        insert or replace into sync_outbox (
          id, workspace_id, entity_type, entity_id, operation_type,
          payload_json, status, attempt_count, last_error, next_retry_at,
          created_at, updated_at
        ) values (?, ?, ?, ?, 'upsert', ?, 'pending', 0, null, ?, ?, ?)
        """,
        (outbox_id, workspace_id, entity_type, entity_id, json.dumps({"repair": "finance-doc-import-audit"}), ts, ts, ts),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply the repair. Without this flag, only prints the plan.")
    parser.add_argument(
        "--db",
        default="/Users/ernestomaxwell/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite",
    )
    parser.add_argument("--backup", default="/private/tmp/bukowski-foundation-before-finance-doc-repair.sqlite")
    args = parser.parse_args()
    db = Path(args.db)
    backup = Path(args.backup)

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")

    workspace_id = fetch_one_id(
        conn,
        "select workspace_id from bank_accounts where account_number_full = ? and currency = ?",
        ("788565075", "DOP"),
    )
    bpd_bad = conn.execute(
        """
        select id, import_id from bank_transactions
        where txn_date = 'Fecha Posteo'
          and amount = 0
          and raw_description = 'Descripción Corta — Descripción'
        order by id
        """
    ).fetchall()
    bsc_usd_import = fetch_one_id(
        conn,
        "select id from bank_statement_imports where original_filename = ?",
        ("BSC_Transacciones20260522122403.xlsx",),
    )
    usd_account_id = "bank-account-santa-cruz-usd-21432020000419"
    bsc_usd_count = conn.execute(
        "select count(*) from bank_transactions where import_id = ? and bank_account_id <> ?",
        (bsc_usd_import, usd_account_id),
    ).fetchone()[0]
    plan = {
        "backup": str(backup),
        "delete_bpd_header_rows": [dict(row) for row in bpd_bad],
        "move_santa_cruz_usd_import": bsc_usd_import,
        "move_santa_cruz_usd_transactions": bsc_usd_count,
        "create_account": {
            "bank": "santa_cruz",
            "currency": "USD",
            "account_number_full": "21432020000419",
            "label": "Santa Cruz USD",
        },
    }
    print(json.dumps(plan, indent=2, ensure_ascii=False))
    if not args.apply:
        print("dry_run=true")
        return 0

    shutil.copy2(db, backup)
    ts = now_iso()
    with conn:
        conn.execute(
            """
            insert into bank_accounts (
              id, workspace_id, bank_name, account_label, account_number_masked,
              account_number_full, currency, account_type, opening_balance,
              opening_balance_date, is_active, notes, created_at, updated_at
            ) values (?, ?, 'santa_cruz', 'Santa Cruz USD', null, ?, 'USD', 'checking', 0, null, 1,
              'Created by finance document audit repair after USD statement was imported into the DOP Santa Cruz account.',
              ?, ?)
            on conflict(id) do update set
              account_label = excluded.account_label,
              account_number_full = excluded.account_number_full,
              currency = excluded.currency,
              is_active = 1,
              updated_at = excluded.updated_at
            """,
            (usd_account_id, workspace_id, "21432020000419", ts, ts),
        )
        enqueue(conn, "sync-repair-bank-account-santa-cruz-usd-21432020000419", workspace_id, "bank_account", usd_account_id)

        for row in bpd_bad:
            conn.execute("delete from transaction_annotations where transaction_id = ?", (row["id"],))
            conn.execute("delete from transaction_links where transaction_id = ?", (row["id"],))
            conn.execute("delete from transaction_project_allocations where transaction_id = ?", (row["id"],))
            conn.execute("delete from bank_transactions where id = ?", (row["id"],))

        for import_id in sorted({row["import_id"] for row in bpd_bad}):
            period_end = fetch_one_id(
                conn,
                "select max(txn_date) from bank_transactions where import_id = ? and txn_date glob '????-??-??'",
                (import_id,),
            )
            counts = conn.execute("select count(*) from bank_transactions where import_id = ?", (import_id,)).fetchone()[0]
            conn.execute(
                """
                update bank_statement_imports
                set row_count = ?, inserted_count = ?, period_end = ?
                where id = ?
                """,
                (counts, counts, period_end, import_id),
            )
            conn.execute(
                """
                update sync_outbox
                set status = 'pending', attempt_count = 0, last_error = null,
                    next_retry_at = ?, updated_at = ?
                where entity_type = 'bank_statement_import' and entity_id = ?
                """,
                (ts, ts, import_id),
            )

        conn.execute(
            "update bank_statement_imports set bank_account_id = ? where id = ?",
            (usd_account_id, bsc_usd_import),
        )
        rows = conn.execute(
            "select * from bank_transactions where import_id = ? and bank_account_id <> ? order by txn_date, id",
            (bsc_usd_import, usd_account_id),
        ).fetchall()
        for row in rows:
            old_id = row["id"]
            new_hash = dedupe_hash(usd_account_id, row, "USD")
            new_id = f"txn-{new_hash}"
            collision = conn.execute(
                "select id from bank_transactions where id = ? and id <> ?",
                (new_id, old_id),
            ).fetchone()
            if collision:
                raise RuntimeError(f"Cannot move {old_id}; target transaction id already exists: {new_id}")
            conn.execute(
                """
                insert into bank_transactions (
                  id, workspace_id, bank_account_id, import_id, txn_date, value_date,
                  raw_description, reference, serial, amount, direction, running_balance,
                  currency, dedupe_hash, created_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?)
                """,
                (
                    new_id,
                    row["workspace_id"],
                    usd_account_id,
                    row["import_id"],
                    row["txn_date"],
                    row["value_date"],
                    row["raw_description"],
                    row["reference"],
                    row["serial"],
                    row["amount"],
                    row["direction"],
                    row["running_balance"],
                    new_hash,
                    row["created_at"],
                ),
            )
            conn.execute("update transaction_annotations set transaction_id = ? where transaction_id = ?", (new_id, old_id))
            conn.execute("update transaction_links set transaction_id = ? where transaction_id = ?", (new_id, old_id))
            conn.execute(
                "update transaction_project_allocations set transaction_id = ? where transaction_id = ?",
                (new_id, old_id),
            )
            conn.execute("delete from bank_transactions where id = ?", (old_id,))
        enqueue(conn, f"sync-repair-{bsc_usd_import}", workspace_id, "bank_statement_import", bsc_usd_import)

    print("applied=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
