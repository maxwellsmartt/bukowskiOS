#!/usr/bin/env python3
from __future__ import annotations

import csv
import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass(frozen=True)
class Txn:
    source_file: str
    bank: str
    currency: str
    account_number: str
    txn_date: str
    value_date: str | None
    raw_description: str | None
    reference: str | None
    serial: str | None
    amount: float
    direction: str
    running_balance: float | None


def money(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)) and not pd.isna(value):
        return float(value)
    s = str(value).strip()
    if not s or s.lower() == "nan":
        return 0.0
    cleaned = re.sub(r"[^0-9.,-]", "", s)
    last_comma = cleaned.rfind(",")
    last_dot = cleaned.rfind(".")
    normalized = cleaned
    if last_comma >= 0 and last_dot >= 0:
        normalized = cleaned.replace(".", "").replace(",", ".") if last_comma > last_dot else cleaned.replace(",", "")
    elif last_comma >= 0:
        decimal_len = len(cleaned) - last_comma - 1
        normalized = cleaned.replace(",", ".") if 0 < decimal_len <= 2 else cleaned.replace(",", "")
    elif cleaned.count(".") > 1:
        last = cleaned.rfind(".")
        decimal_len = len(cleaned) - last - 1
        normalized = cleaned[:last].replace(".", "") + "." + cleaned[last + 1 :] if 0 < decimal_len <= 2 else cleaned.replace(".", "")
    elif last_dot >= 0 and len(cleaned) - last_dot - 1 == 3:
        normalized = cleaned.replace(".", "")
    try:
        return float(normalized)
    except ValueError:
        return 0.0


def iso_date(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if hasattr(value, "to_pydatetime"):
        return value.to_pydatetime().strftime("%Y-%m-%d")
    s = "" if value is None else str(value).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
    if m:
        dd, mm, yy = m.groups()
        if len(yy) == 2:
            yy = "20" + yy
        return f"{yy}-{mm.zfill(2)}-{dd.zfill(2)}"
    return s


def clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def is_real_date(value: Any) -> bool:
    s = clean(value)
    return bool(re.match(r"^\d{1,2}/\d{1,2}/\d{2,4}$", s) or re.match(r"^\d{4}-\d{2}-\d{2}", s))


def parse_bpd_csv(path: Path, currency: str | None = None) -> list[Txn]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    account = ""
    lines = text.splitlines()
    for line in lines:
        m = re.search(r"Cuenta:\s*0*([0-9]+)", line, flags=re.I)
        if m:
            account = m.group(1)
            break
    header_idx = next((i for i, line in enumerate(lines) if "Fecha Posteo" in line and "Monto" in line), -1)
    rows: list[Txn] = []
    if header_idx < 0:
        return rows
    reader = csv.DictReader(lines[header_idx:])
    for rec in reader:
        keys = list(rec.keys())
        def get(needle: str) -> str:
            key = next((k for k in keys if needle in k.lower()), None)
            return clean(rec.get(key)) if key else ""

        date_raw = get("fecha")
        amount_raw = get("monto")
        if not date_raw or not amount_raw or not is_real_date(date_raw):
            continue
        short_key = next((k for k in keys if "corta" in k.lower()), None)
        long_key = next((k for k in keys if "descrip" in k.lower() and "corta" not in k.lower()), None)
        short_desc = clean(rec.get(short_key)) if short_key else ""
        long_desc = clean(rec.get(long_key)) if long_key else ""
        direction = "credit" if re.match(r"^(cr|cré|cre)", short_desc, flags=re.I) else "debit"
        amount = abs(money(amount_raw))
        if amount == 0 and not short_desc:
            continue
        rows.append(
            Txn(
                path.name,
                "popular",
                currency or ("USD" if "US" in path.name.upper() else "DOP"),
                account,
                iso_date(date_raw),
                None,
                " — ".join(x for x in [short_desc, long_desc] if x),
                get("referencia") or None,
                get("serial") or None,
                round(amount, 2),
                direction,
                round(money(get("balance")), 2) if get("balance") else None,
            )
        )
    return rows


def parse_bsc_xlsx(path: Path) -> list[Txn]:
    grid = pd.read_excel(path, header=None, dtype=object).fillna("")
    account = ""
    currency = "DOP"
    header = None
    cols = {}
    for i, row in grid.iterrows():
        cells = [clean(v) for v in row.tolist()]
        joined = " ".join(cells)
        m = re.search(r"/\s*0*([0-9]{6,})\s*/", joined)
        if m and not account:
            account = m.group(1)
        if re.search(r"USD|US\$", joined, flags=re.I):
            currency = "USD"
        lower = [c.lower() for c in cells]
        date_idx = next((idx for idx, c in enumerate(lower) if "fecha de posteo" in c), -1)
        out_idx = next((idx for idx, c in enumerate(lower) if "retiro" in c), -1)
        in_idx = next((idx for idx, c in enumerate(lower) if "dep" in c), -1)
        if date_idx >= 0 and out_idx >= 0 and in_idx >= 0:
            header = i
            cols = {
                "date": date_idx,
                "desc": next((idx for idx, c in enumerate(lower) if "descrip" in c), -1),
                "ref": next((idx for idx, c in enumerate(lower) if "referencia" in c), -1),
                "check": next((idx for idx, c in enumerate(lower) if "cheque" in c), -1),
                "out": out_idx,
                "in": in_idx,
            }
            break
    if header is None:
        return []
    rows: list[Txn] = []
    for _, row in grid.iloc[header + 1 :].iterrows():
        cells = row.tolist()
        date_raw = clean(cells[cols["date"]])
        if not date_raw or not re.search(r"\d", date_raw):
            continue
        withdrawals = money(cells[cols["out"]])
        deposits = money(cells[cols["in"]])
        is_credit = deposits > 0 and deposits >= withdrawals
        amount = abs(deposits if is_credit else withdrawals)
        if amount == 0:
            continue
        rows.append(
            Txn(
                path.name,
                "santa_cruz",
                currency,
                account,
                iso_date(date_raw),
                None,
                clean(cells[cols["desc"]]) if cols["desc"] >= 0 else None,
                clean(cells[cols["ref"]]) if cols["ref"] >= 0 and clean(cells[cols["ref"]]) else None,
                clean(cells[cols["check"]]) if cols["check"] >= 0 and clean(cells[cols["check"]]) else None,
                round(amount, 2),
                "credit" if is_credit else "debit",
                None,
            )
        )
    return rows


PDF_MONEY = re.compile(r"\$[\d,]+\.\d{2}-?")
PDF_DATE = re.compile(r"^\s*(\d{2}/\d{2}/\d{4})\b")


def pdf_money(token: str) -> tuple[float, bool]:
    negative = token.endswith("-")
    return float(token.replace("$", "").replace(",", "").replace("-", "")), negative


def parse_bpd_pdf(path: Path) -> list[Txn]:
    text = subprocess.check_output(["pdftotext", "-layout", str(path), "-"], text=True)
    currency = "USD" if "_USD_" in path.name.upper() else "DOP"
    account = "819426362" if currency == "USD" else "788565075"
    rows: list[Txn] = []
    block: list[str] = []

    def flush() -> None:
        nonlocal block
        if not block:
            return
        anchor_idx = next((i for i, line in enumerate(block) if PDF_DATE.search(line) and len(PDF_MONEY.findall(line)) >= 2), -1)
        if anchor_idx < 0:
            block = []
            return
        anchor = block[anchor_idx]
        date = PDF_DATE.search(anchor).group(1)
        monies = PDF_MONEY.findall(anchor)
        amount, negative = pdf_money(monies[-2])
        balance, _ = pdf_money(monies[-1])
        after_dates = re.sub(r"^\s*\d{2}/\d{2}/\d{4}\s+\d{2}/\d{2}/\d{4}", "", anchor)
        ref_m = re.search(r"\b(\d{3,})\b", after_dates)
        ref = ref_m.group(1) if ref_m else ""
        on_line = after_dates
        money_m = PDF_MONEY.search(on_line)
        if money_m:
            on_line = on_line[: money_m.start()]
        if ref:
            on_line = on_line.replace(ref, " ")
        fragments = []
        for i, line in enumerate(block):
            if i == anchor_idx:
                continue
            s = line.strip()
            if not s or re.search(r"Fecha\s+(posteo|efectiva)|Nro\.|Descripci|Balance|Banco Popular|METADATA CINE|P[áa]gina|Estado de|Saldo (Anterior|Disponible)|Total", s, flags=re.I):
                continue
            fragments.append(s)
        desc = " ".join([*fragments, on_line.strip()]).strip()
        rows.append(
            Txn(
                path.name,
                "popular",
                currency,
                account,
                iso_date(date),
                None,
                desc or None,
                ref or None,
                ref or None,
                round(abs(amount), 2),
                "debit" if negative else "credit",
                round(balance, 2),
            )
        )
        block = []

    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            flush()
        else:
            block.append(line)
    flush()
    return rows


def dedupe_hash(account_id: str, row: dict[str, Any]) -> str:
    amount = f"{round(float(row['amount']) + 1e-12, 2):.2f}"
    balance = "" if row.get("running_balance") is None else f"{round(float(row['running_balance']) + 1e-12, 2):.2f}"
    parts = [
        account_id,
        row["txn_date"],
        amount,
        row["direction"],
        (row.get("raw_description") or "").strip(),
        balance,
        (row.get("reference") or "").strip(),
        (row.get("serial") or "").strip(),
    ]
    return hashlib.sha1("|".join(parts).encode()).hexdigest()


def key(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        row["bank"],
        row["currency"],
        row["account_number"],
        row["txn_date"],
        row["direction"],
        round(float(row["amount"]), 2),
        (row.get("reference") or "").strip(),
        (row.get("serial") or "").strip(),
        (row.get("raw_description") or "").strip(),
        None if row.get("running_balance") is None else round(float(row["running_balance"]), 2),
    )


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    c = Counter((r["bank"], r["currency"], r["account_number"]) for r in rows)
    totals = defaultdict(lambda: {"rows": 0, "credits": 0.0, "debits": 0.0, "min_date": None, "max_date": None})
    for r in rows:
        k = f"{r['bank']}|{r['currency']}|{r['account_number']}"
        t = totals[k]
        t["rows"] += 1
        t["credits" if r["direction"] == "credit" else "debits"] += round(float(r["amount"]), 2)
        d = r["txn_date"]
        t["min_date"] = d if t["min_date"] is None or d < t["min_date"] else t["min_date"]
        t["max_date"] = d if t["max_date"] is None or d > t["max_date"] else t["max_date"]
    for t in totals.values():
        t["credits"] = round(t["credits"], 2)
        t["debits"] = round(t["debits"], 2)
    return {"groups": {str(k): v for k, v in c.items()}, "totals": dict(totals)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit local treasury imports against bank statement files.")
    parser.add_argument("--docs-dir", default="/Users/ernestomaxwell/Desktop/Desktop MD/finance docs")
    parser.add_argument(
        "--db",
        default="/Users/ernestomaxwell/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite",
    )
    parser.add_argument("--out", default="/private/tmp/bukowski_finance_audit.json")
    parser.add_argument("--backfill-before", default="2026-02-21")
    args = parser.parse_args()
    root = Path(args.docs_dir)
    db = Path(args.db)
    out = Path(args.out)

    source_rows: list[Txn] = []
    source_files = [
        root / "BPD_RD_backfill.csv",
        root / "BPD_RD_FEB21 a MAY22.csv",
        root / "BPD_US_backfill.csv",
        root / "BPD_US_FEB21 a MAY22.csv",
        root / "BSC_Transacciones20260522122330.xlsx",
        root / "BSC_Transacciones20260522122403.xlsx",
    ]
    for path in source_files:
        if path.suffix.lower() == ".xlsx":
            source_rows.extend(parse_bsc_xlsx(path))
        else:
            source_rows.extend(parse_bpd_csv(path))

    pdf_rows_by_file: dict[str, int] = {}
    pdf_before_cutoff: list[Txn] = []
    for pdf in sorted(root.glob("*.pdf")):
        parsed = parse_bpd_pdf(pdf)
        pdf_rows_by_file[pdf.name] = len(parsed)
        pdf_before_cutoff.extend([r for r in parsed if r.txn_date < args.backfill_before])

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    accounts = {
        row["id"]: row
        for row in conn.execute(
            "select id, bank_name, currency, account_number_full from bank_accounts"
        )
    }
    db_rows: list[dict[str, Any]] = []
    for row in conn.execute(
        """
        select bt.*, ba.bank_name bank, ba.currency account_currency, ba.account_number_full account_number
        from bank_transactions bt join bank_accounts ba on ba.id = bt.bank_account_id
        """
    ):
        db_rows.append(
            {
                "id": row["id"],
                "source_file": row["import_id"],
                "bank": row["bank"],
                "currency": row["currency"],
                "account_number": row["account_number"],
                "bank_account_id": row["bank_account_id"],
                "txn_date": row["txn_date"],
                "value_date": row["value_date"],
                "raw_description": row["raw_description"],
                "reference": row["reference"],
                "serial": row["serial"],
                "amount": row["amount"],
                "direction": row["direction"],
                "running_balance": row["running_balance"],
                "dedupe_hash": row["dedupe_hash"],
            }
        )

    source_dicts = [asdict(r) for r in source_rows]
    source_keys = Counter(key(r) for r in source_dicts)
    db_keys = Counter(key(r) for r in db_rows)
    missing = list((source_keys - db_keys).elements())
    extra = list((db_keys - source_keys).elements())

    invalid_db_rows = [r for r in db_rows if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(r["txn_date"]))]
    duplicates_by_exact_key = [dict(key=str(k), count=v) for k, v in db_keys.items() if v > 1]

    account_id_by_sig = {
        (row["bank_name"], row["currency"], row["account_number_full"]): row["id"]
        for row in accounts.values()
    }
    source_hashes = []
    for r in source_dicts:
        account_id = account_id_by_sig.get((r["bank"], r["currency"], r["account_number"]))
        if account_id:
            source_hashes.append(dedupe_hash(account_id, r))
    db_hashes = [r["dedupe_hash"] for r in db_rows]

    report = {
        "source_files": [str(p) for p in source_files],
        "pdf_rows_by_file": pdf_rows_by_file,
        "pdf_before_cutoff_count": len(pdf_before_cutoff),
        "source_summary": summarize(source_dicts),
        "db_summary": summarize(db_rows),
        "source_rows": len(source_dicts),
        "db_rows": len(db_rows),
        "source_hash_count": len(source_hashes),
        "source_hash_unique": len(set(source_hashes)),
        "db_hash_count": len(db_hashes),
        "db_hash_unique": len(set(db_hashes)),
        "missing_count": len(missing),
        "extra_count": len(extra),
        "invalid_db_rows": invalid_db_rows,
        "duplicate_exact_keys": duplicates_by_exact_key[:50],
        "missing_sample": [list(m) for m in missing[:25]],
        "extra_sample": [list(e) for e in extra[:25]],
    }
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ["source_rows", "db_rows", "missing_count", "extra_count", "pdf_rows_by_file", "pdf_before_cutoff_count"]}, indent=2, ensure_ascii=False))
    print(f"report={out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
