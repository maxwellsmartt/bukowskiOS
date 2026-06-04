import * as XLSX from "xlsx";

export const MAX_XLSX_BYTES = 5 * 1024 * 1024;
export const MAX_XLSX_SHEETS = 4;
export const MAX_XLSX_ROWS = 5_000;
export const MAX_XLSX_COLUMNS = 64;

const createXlsxImportError = (message: string) => new Error(`Spreadsheet import rejected: ${message}`);

const formatMiB = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

const normalizeCell = (value: unknown) => (value == null ? "" : String(value));

export const parseBoundedXlsxGrid = (
  data: ArrayBuffer | Uint8Array,
  sourceLabel = "spreadsheet",
): string[][] => {
  const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;

  if (byteLength <= 0) {
    throw createXlsxImportError(`${sourceLabel} is empty`);
  }

  if (byteLength > MAX_XLSX_BYTES) {
    throw createXlsxImportError(
      `${sourceLabel} exceeds the ${formatMiB(MAX_XLSX_BYTES)} safety limit`,
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, {
      type: "array",
      sheetRows: MAX_XLSX_ROWS + 1,
      dense: false,
      WTF: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid workbook";
    throw createXlsxImportError(message);
  }

  if (!workbook.SheetNames.length) {
    throw createXlsxImportError(`${sourceLabel} does not contain any sheets`);
  }

  if (workbook.SheetNames.length > MAX_XLSX_SHEETS) {
    throw createXlsxImportError(
      `${sourceLabel} contains ${workbook.SheetNames.length} sheets; maximum allowed is ${MAX_XLSX_SHEETS}`,
    );
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw createXlsxImportError(`${sourceLabel} does not contain a readable first sheet`);
  }

  const firstSheet = workbook.Sheets[firstSheetName];
  if (!firstSheet) {
    throw createXlsxImportError(`${sourceLabel} does not contain a readable first sheet`);
  }

  const ref = firstSheet["!ref"];
  if (typeof ref === "string") {
    try {
      const range = XLSX.utils.decode_range(ref);
      const columnCount = range.e.c - range.s.c + 1;
      if (columnCount > MAX_XLSX_COLUMNS) {
        throw createXlsxImportError(
          `${sourceLabel} contains ${columnCount} columns; maximum allowed is ${MAX_XLSX_COLUMNS}`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Spreadsheet import rejected:")) {
        throw error;
      }
      throw createXlsxImportError(`${sourceLabel} has an invalid sheet range`);
    }
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][];

  if (grid.length > MAX_XLSX_ROWS) {
    throw createXlsxImportError(
      `${sourceLabel} contains more than ${MAX_XLSX_ROWS} rows`,
    );
  }

  const widestRow = grid.reduce((max, row) => Math.max(max, row.length), 0);
  if (widestRow > MAX_XLSX_COLUMNS) {
    throw createXlsxImportError(
      `${sourceLabel} contains ${widestRow} columns; maximum allowed is ${MAX_XLSX_COLUMNS}`,
    );
  }

  return grid.map((row) => row.map(normalizeCell));
};
