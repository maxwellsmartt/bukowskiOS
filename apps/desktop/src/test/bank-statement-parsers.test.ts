import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { parseBancoPopularCsv, parseBancoSantaCruzXlsx } from "../features/finance/treasury/bankStatementParsers";
import { MAX_XLSX_SHEETS } from "../shared/lib/xlsxSafety";

describe("bank statement parsers", () => {
  it("extracts Banco Popular account metadata without needing full account persistence", () => {
    const parsed = parseBancoPopularCsv(`METADATA CINE SRL
Banco Popular Dominicano
Cuenta: 000000000000788565075

Fecha Posteo,Descripción Corta,Monto Transacción,Balance,No. Referencia,No. Serial,Descripción
03/10/2025,Débito,100.00,179865.66,REF-1,SER-1,EXI COMISIONES LBTR
`);

    expect(parsed.bankName).toBe("popular");
    expect(parsed.accountNumber?.slice(-4)).toBe("5075");
    expect(parsed.rows).toHaveLength(1);
  });

  it("parses a Santa Cruz XLSX statement", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Estado de Cuenta", "", "", ""],
      ["Cuenta / 0001234567 /", "", "", "USD"],
      ["Fecha de Posteo", "Descripción", "Retiros", "Depósitos", "Referencia", "Cheque"],
      ["01/05/2026", "Transferencia recibida", 0, 1250, "REF-1", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Hoja1");

    const parsed = parseBancoSantaCruzXlsx(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

    expect(parsed.bankName).toBe("santa_cruz");
    expect(parsed.accountNumber).toBe("1234567");
    expect(parsed.accountNumber?.slice(-4)).toBe("4567");
    expect(parsed.currencyHint).toBe("USD");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      txnDate: "2026-05-01",
      amount: 1250,
      direction: "credit",
      reference: "REF-1",
    });
  });

  it("rejects XLSX statements with too many sheets", () => {
    const workbook = XLSX.utils.book_new();
    for (let index = 0; index < MAX_XLSX_SHEETS + 1; index += 1) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([["Fecha de Posteo", "Retiros", "Depósitos"], ["01/05/2026", 0, 1]]),
        `Sheet${index + 1}`,
      );
    }

    expect(() =>
      parseBancoSantaCruzXlsx(XLSX.write(workbook, { type: "array", bookType: "xlsx" })),
    ).toThrow("Spreadsheet import rejected: bank statement XLSX contains");
  });
});
