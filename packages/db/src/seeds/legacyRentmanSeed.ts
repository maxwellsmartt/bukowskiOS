import rawLegacyRentmanRows from "./legacy-rentman-20211015.json";

export const LEGACY_RENTMAN_IMPORT_ID = "legacy-rentman-20211015-v1";
export const LEGACY_RENTMAN_SOURCE_FILE = "legacy-rentman-20211015.csv";
export const LEGACY_RENTMAN_SOURCE_LABEL = "Rentman legacy inventory";

type RawLegacyRentmanRow = {
  "Número de Serie (Número de serie)"?: string;
  "ID (Número de serie)"?: string;
  "Nombre (en la base de datos)"?: string;
  "Cantidad actual"?: string;
  "Ubicado en almacén"?: string;
  "Tiene accesorios"?: string;
  "Códigos QR"?: string;
  "Estructura de la carpeta (Carpeta)"?: string;
  "Tipo de articulo (Carpeta)"?: string;
  "Código"?: string;
  "Nombre (en la base de datos) 2"?: string;
  "Tipo (posición/case/set)"?: string;
  "Nota externa"?: string;
};

export type LegacyRentmanSeedRow = {
  rowNumber: number;
  serialNumber: string;
  serialIdentifier: string;
  primaryName: string;
  quantity: number;
  warehouseSlot: string;
  hasAccessories: boolean;
  qrCode: string;
  folderPath: string;
  folderType: string;
  legacyCode: string;
  secondaryName: string;
  positionType: string;
  externalNote: string;
  raw: RawLegacyRentmanRow;
};

const cleanValue = (value: string | undefined) => value?.trim() ?? "";

const parseQuantity = (value: string | undefined) => {
  const parsed = Number.parseInt(cleanValue(value), 10);

  return Number.isFinite(parsed) ? parsed : 0;
};

export const legacyRentmanSeedRows: LegacyRentmanSeedRow[] = (rawLegacyRentmanRows as RawLegacyRentmanRow[]).map(
  (row, index) => ({
    rowNumber: index + 1,
    serialNumber: cleanValue(row["Número de Serie (Número de serie)"]),
    serialIdentifier: cleanValue(row["ID (Número de serie)"]),
    primaryName: cleanValue(row["Nombre (en la base de datos)"]),
    quantity: parseQuantity(row["Cantidad actual"]),
    warehouseSlot: cleanValue(row["Ubicado en almacén"]),
    hasAccessories: cleanValue(row["Tiene accesorios"]) === "1",
    qrCode: cleanValue(row["Códigos QR"]),
    folderPath: cleanValue(row["Estructura de la carpeta (Carpeta)"]),
    folderType: cleanValue(row["Tipo de articulo (Carpeta)"]),
    legacyCode: cleanValue(row["Código"]),
    secondaryName: cleanValue(row["Nombre (en la base de datos) 2"]),
    positionType: cleanValue(row["Tipo (posición/case/set)"]),
    externalNote: cleanValue(row["Nota externa"]),
    raw: row,
  }),
);
