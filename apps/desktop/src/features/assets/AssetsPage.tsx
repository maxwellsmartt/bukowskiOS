import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ClipboardList, FileUp, Plus, SquarePen, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { AssetListQuery, AssetListRow, AssetSortField } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { PackingSlipBuilderPanel, type PackingSlipBuilderDraft } from "@features/packing/PackingSlipBuilderPanel";
import { createPackingSlip } from "@features/packing/usePackingData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListToolbar } from "@shared/components/ListToolbar";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useShellContext } from "@shared/hooks/useShellContext";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { resolveAssetAvailability, summarizeUnavailableAssets } from "@shared/lib/assetAvailability";
import { formatAssetStockDetailRows, formatAssetStockInline } from "@shared/lib/assetQuantityPresentation";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { AssetAssignMovePanel, type AssetAssignMoveFormValue } from "./AssetAssignMovePanel";
import { AssetEditorPanel, type AssetEditorDraft } from "./AssetEditorPanel";
import {
  archiveAsset,
  assignMoveAssets,
  createAsset,
  openAssetFile,
  updateAsset,
  uploadAssetImages,
  useAssetDetail,
  useAssetsList,
  useAssetsOverview,
} from "./useAssetsData";

type AssetsPageProps = {
  projectId?: string | null;
  projectName?: string | null;
};

const assetSortOptions: Array<ListSortOption<AssetSortField>> = [
  { value: "name", label: "Name", columnKey: "asset" },
  { value: "code", label: "Code" },
  { value: "category", label: "Category", columnKey: "category" },
  { value: "status", label: "Status", columnKey: "status" },
  { value: "condition", label: "Condition", columnKey: "condition" },
  { value: "location", label: "Location", columnKey: "location" },
  { value: "project", label: "Project", columnKey: "project" },
  { value: "projectUnit", label: "Unit", columnKey: "projectUnit" },
  { value: "responsible", label: "Responsible", columnKey: "responsible" },
  { value: "serialNumber", label: "Serial", columnKey: "serialNumber" },
  { value: "qrCode", label: "QR", columnKey: "qrCode" },
  { value: "incidentsOpen", label: "Open issues", columnKey: "incidents" },
  { value: "updatedAt", label: "Updated" },
  { value: "createdAt", label: "Created" },
];

const assetDefaultColumnKeys = ["asset", "category", "quantity", "status", "condition", "location", "project", "responsible"];

const normalizeCsvHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
const normalizeCsvLookup = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
const allowedCsvConditions = new Set(["Good", "Review", "Damaged"]);

const parseCsvText = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"" && inQuotes && nextCharacter === "\"") {
      value += "\"";
      index += 1;
      continue;
    }

    if (character === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(value.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += character;
  }

  if (inQuotes) {
    throw new Error("The CSV contains an unterminated quoted value.");
  }

  row.push(value.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
};

const resolveCsvValue = (row: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const value = row[normalizeCsvHeader(key)]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
};

const hasCsvColumn = (headers: string[], keys: string[]) => keys.some((key) => headers.includes(normalizeCsvHeader(key)));

const parseCsvQuantity = (value: string, rowNumber: number) => {
  if (!value) {
    return 1;
  }

  const parsed = Number.parseInt(value.replace(/[,\s]/g, ""), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Row ${rowNumber}: quantity must be a whole number.`);
  }

  return parsed;
};

const parseCsvMoney = (value: string, rowNumber: number, label: string) => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Row ${rowNumber}: ${label} must be a valid amount.`);
  }

  return parsed;
};

const parseEditableCsvQuantity = (value: string, rowIssues: string[]) => {
  if (!value) {
    return 1;
  }

  try {
    return parseCsvQuantity(value, 0);
  } catch {
    rowIssues.push("Quantity could not be read. Set a whole number before importing.");
    return 0;
  }
};

const parseEditableCsvMoney = (value: string, label: string, rowIssues: string[]) => {
  if (!value) {
    return undefined;
  }

  try {
    return parseCsvMoney(value, 0, label);
  } catch {
    rowIssues.push(`${label} could not be read and was left blank.`);
    return undefined;
  }
};

const joinCsvNotes = (parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join("\n");
const getErrorMessage = (error: unknown) =>
  getUserFacingErrorMessage(error, typeof error === "string" ? error : String(error));
const isDuplicateRegistryCodeError = (error: unknown) =>
  /(?:registry|asset) code .* already in use/i.test(getErrorMessage(error));

type AssetCsvDraft = {
  importRowNumber: number;
  name: string;
  internalCode: string;
  categoryId: string;
  defaultLocationId: string | undefined;
  brand: string;
  model: string;
  serialNumber: string;
  description: string;
  conditionStatus: string;
  notes: string;
  purchasePrice: number | undefined;
  additionalCosts: number | undefined;
  replacementValue: number | undefined;
  currentBookValue: number | undefined;
  ownershipType: string;
  qrCodeValue: string;
  totalQuantity: number;
  importWarnings?: string[];
};

type AssetCsvCatalogOption = {
  id: string;
  code: string;
  name: string;
};

type AssetCsvPreview = {
  fileName: string;
  drafts: AssetCsvDraft[];
  existingMatches: Array<{
    code: string;
    csvName: string;
    existingName: string;
    existingStock: number;
    category: string;
    location: string;
  }>;
  errors: Array<{
    rowNumber: number;
    message: string;
  }>;
  summary: {
    totalRows: number;
    uniqueCodes: number;
    duplicateRows: number;
    existingCodes: number;
    importableCount: number;
    importableStock: number;
    allRowsExist: boolean;
    stockSource: "declaredQuantity" | "mergedRows";
    warnings: string[];
  };
};

type AssetCsvValidationIssue = {
  rowNumber: number;
  message: string;
};

const buildAssetCsvDerivedSummary = (preview: AssetCsvPreview, assets: AssetListRow[]) => {
  const existingCodes = new Set(assets.map((asset) => asset.code.trim().toUpperCase()).filter(Boolean));
  const importableDrafts = preview.drafts.filter((draft) => !existingCodes.has(draft.internalCode.trim().toUpperCase()));
  const importableCodeCounts = importableDrafts.reduce<Record<string, number>>((counts, draft) => {
    const normalizedCode = draft.internalCode.trim().toUpperCase();
    if (normalizedCode) {
      counts[normalizedCode] = (counts[normalizedCode] ?? 0) + 1;
    }

    return counts;
  }, {});
  const validationIssues = importableDrafts.reduce<AssetCsvValidationIssue[]>((issues, draft) => {
    const rowNumber = draft.importRowNumber;
    const normalizedCode = draft.internalCode.trim().toUpperCase();

    if (!draft.name.trim()) {
      issues.push({ rowNumber, message: "Asset name is required." });
    }

    if (!normalizedCode) {
      issues.push({ rowNumber, message: "Asset code is required." });
    }

    if (normalizedCode && importableCodeCounts[normalizedCode] > 1) {
      issues.push({ rowNumber, message: "Asset code is repeated in the editable import rows." });
    }

    if (!draft.categoryId) {
      issues.push({ rowNumber, message: "Choose a category." });
    }

    if (!Number.isInteger(draft.totalQuantity) || draft.totalQuantity < 0) {
      issues.push({ rowNumber, message: "Quantity must be a whole number." });
    }

    return issues;
  }, []);
  const issueCountByRow = validationIssues.reduce<Record<number, number>>((counts, issue) => {
    counts[issue.rowNumber] = (counts[issue.rowNumber] ?? 0) + 1;
    return counts;
  }, {});
  const readyDrafts = importableDrafts.filter((draft) => !issueCountByRow[draft.importRowNumber]);
  const needsReviewDrafts = importableDrafts.filter((draft) => Boolean(issueCountByRow[draft.importRowNumber]));

  return {
    importableDrafts,
    readyDrafts,
    needsReviewDrafts,
    validationIssues,
    issueCountByRow,
    importableCount: importableDrafts.length,
    existingCount: preview.drafts.length - importableDrafts.length,
    importableStock: importableDrafts.reduce((total, draft) => total + draft.totalQuantity, 0),
    canImport: importableDrafts.length > 0 && preview.errors.length === 0 && validationIssues.length === 0,
  };
};

type AssetOperationCartItem = AssetListRow & {
  requestedQuantity: number;
};

const resolveAssignableQuantity = (asset: Pick<AssetListRow, "quantity">) => Math.max(0, asset.quantity);

const clampOperationQuantity = (asset: Pick<AssetListRow, "quantity">, quantity: number | undefined) => {
  const maxQuantity = resolveAssignableQuantity(asset);

  if (maxQuantity <= 0) {
    return 0;
  }

  const nextQuantity = Math.trunc(quantity ?? 1);
  return Math.min(maxQuantity, Math.max(1, Number.isFinite(nextQuantity) ? nextQuantity : 1));
};

const buildOperationCartItem = (asset: AssetListRow, quantity?: number): AssetOperationCartItem => ({
  ...asset,
  requestedQuantity: clampOperationQuantity(asset, quantity),
});

type AssetOperationCartProps = {
  items: AssetOperationCartItem[];
  onAddToCompare: () => void;
  onClear: () => void;
  onCreatePackingSlip: () => void;
  onCreateRma: () => void;
  onOpenAssignMove: () => void;
  onOpenAssetDetail: (assetId: string) => void;
  onOpenProjectReturns?: () => void;
  onQuantityChange: (assetId: string, quantity: number) => void;
  onRemove: (assetId: string) => void;
};

const AssetOperationCart = ({
  items,
  onAddToCompare,
  onClear,
  onCreatePackingSlip,
  onCreateRma,
  onOpenAssignMove,
  onOpenAssetDetail,
  onOpenProjectReturns,
  onQuantityChange,
  onRemove,
}: AssetOperationCartProps) => {
  if (!items.length) {
    return null;
  }

  const lockedItems = items.filter((asset) => asset.linkedKitCount > 0);
  const unavailableItems = items.filter((asset) => asset.linkedKitCount <= 0 && !resolveAssetAvailability(asset).isAvailable);
  const totalUnits = items.reduce((total, asset) => total + asset.requestedQuantity, 0);
  const issueActionsDisabled = lockedItems.length > 0 || unavailableItems.length > 0;
  const singleAsset = items.length === 1 ? items[0] : null;
  const checkedOutUnits = items.reduce((total, asset) => total + asset.checkedOutQuantity, 0);

  return (
    <div className="asset-operation-cart">
      <div className="asset-operation-cart-header">
        <div className="asset-operation-cart-copy">
          <span className="asset-operation-cart-kicker">Operation cart</span>
          <strong>{items.length === 1 ? "1 asset selected" : `${items.length} assets selected`}</strong>
          <span>{totalUnits === 1 ? "1 unit queued" : `${totalUnits} units queued`}</span>
        </div>
        <button aria-label="Clear operation cart" className="icon-ghost-control is-danger" data-tooltip="Clear cart" onClick={onClear} type="button">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="asset-operation-cart-actions">
        <button className="ghost-control action-row-button" onClick={onAddToCompare} type="button">
          Add to compare
        </button>
        <button
          className="ghost-control action-row-button"
          data-tooltip={singleAsset ? "Open asset detail to report an issue" : "Select one asset to report an issue"}
          disabled={!singleAsset}
          onClick={() => singleAsset && onOpenAssetDetail(singleAsset.id)}
          type="button"
        >
          Report issue
        </button>
        <button
          className="ghost-control action-row-button"
          data-tooltip={singleAsset ? "Open RMA workspace" : "Select one asset to prepare an RMA"}
          disabled={!singleAsset}
          onClick={onCreateRma}
          type="button"
        >
          Create RMA
        </button>
        <button
          className="ghost-control action-row-button"
          disabled={issueActionsDisabled}
          onClick={onCreatePackingSlip}
          type="button"
        >
          Create packing slip
        </button>
        <button
          className="action-primary-button action-row-button"
          disabled={lockedItems.length > 0}
          onClick={onOpenAssignMove}
          type="button"
        >
          Assign / move
        </button>
        {onOpenProjectReturns ? (
          <button
            className="ghost-control action-row-button"
            data-tooltip={checkedOutUnits ? "Open project packing slips to process returns" : "No selected units are checked out yet"}
            disabled={!checkedOutUnits}
            onClick={onOpenProjectReturns}
            type="button"
          >
            Return
          </button>
        ) : null}
      </div>

      {lockedItems.length || unavailableItems.length ? (
        <div className="asset-operation-cart-warning">
          {lockedItems.length ? `${lockedItems.length} asset${lockedItems.length === 1 ? "" : "s"} locked by active kit.` : null}
          {lockedItems.length && unavailableItems.length ? " " : ""}
          {unavailableItems.length ? summarizeUnavailableAssets(unavailableItems) : null}
        </div>
      ) : null}

      <div className="asset-operation-cart-list">
        {items.map((asset) => {
          const maxQuantity = resolveAssignableQuantity(asset);
          const isLocked = asset.linkedKitCount > 0;
          const availability = resolveAssetAvailability(asset);
          const isUnavailable = !availability.isAvailable;

          return (
            <div className={`asset-operation-cart-row${isLocked || isUnavailable ? " is-warning" : ""}`} key={asset.id}>
              <div className="asset-operation-cart-row-copy">
                <span className="asset-operation-cart-title">{asset.name}</span>
                <span className="asset-operation-cart-meta">
                  {asset.code} · {availability.label} · {availability.reason}
                </span>
              </div>
              <label className="asset-operation-cart-quantity">
                <span className="action-field-label">Qty</span>
                <input
                  className="action-field-control"
                  disabled={isUnavailable}
                  max={Math.max(1, maxQuantity)}
                  min={isUnavailable ? 0 : 1}
                  onChange={(event) => onQuantityChange(asset.id, Number.parseInt(event.target.value, 10))}
                  type="number"
                  value={isUnavailable ? 0 : Math.max(1, asset.requestedQuantity)}
                />
              </label>
              <button
                aria-label={`Remove ${asset.name} from operation cart`}
                className="icon-ghost-control"
                data-tooltip="Remove"
                onClick={() => onRemove(asset.id)}
                type="button"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const aggregateAssetCsvDrafts = (drafts: AssetCsvDraft[]) => {
  const draftsByCode = new Map<string, AssetCsvDraft & { importRowNumbers: number[]; serialNumbers: string[] }>();
  let mergedDuplicateRows = 0;
  let duplicateGroups = 0;
  let ambiguousQuantityGroups = 0;

  for (const draft of drafts) {
    const normalizedCode = draft.internalCode.trim().toUpperCase();
    const aggregateKey = normalizedCode || `__row_${draft.importRowNumber}`;
    const existingDraft = draftsByCode.get(aggregateKey);

    if (!existingDraft) {
      draftsByCode.set(aggregateKey, {
        ...draft,
        importRowNumbers: [draft.importRowNumber],
        serialNumbers: draft.serialNumber ? [draft.serialNumber] : [],
      });
      continue;
    }

    mergedDuplicateRows += 1;
    if (existingDraft.importRowNumbers.length === 1) {
      duplicateGroups += 1;
    }
    existingDraft.importRowNumbers.push(draft.importRowNumber);
    if (draft.totalQuantity !== existingDraft.totalQuantity) {
      ambiguousQuantityGroups += 1;
    }
    existingDraft.totalQuantity = Math.max(existingDraft.totalQuantity, draft.totalQuantity, existingDraft.importRowNumbers.length);

    if (draft.serialNumber && !existingDraft.serialNumbers.includes(draft.serialNumber)) {
      existingDraft.serialNumbers.push(draft.serialNumber);
    }

    if (draft.importWarnings?.length) {
      existingDraft.importWarnings = Array.from(new Set([...(existingDraft.importWarnings ?? []), ...draft.importWarnings]));
    }
  }

  return {
    drafts: Array.from(draftsByCode.values()).map(({ importRowNumbers, serialNumbers, ...draft }) => ({
      ...draft,
      importRowNumber: importRowNumbers[0] ?? draft.importRowNumber,
      notes: joinCsvNotes([
        draft.notes,
        serialNumbers.length > 1 && `Source serials: ${serialNumbers.join(", ")}`,
        importRowNumbers.length > 1 && `Merged CSV rows: ${importRowNumbers.join(", ")}`,
      ]),
      importWarnings: draft.importWarnings,
    })),
    mergedDuplicateRows,
    duplicateGroups,
    ambiguousQuantityGroups,
  };
};

const buildAssetCsvPreview = ({
  assets,
  catalog,
  csvText,
  fileName,
}: {
  assets: AssetListRow[];
  catalog: {
    categories: AssetCsvCatalogOption[];
    locations: AssetCsvCatalogOption[];
  };
  csvText: string;
  fileName: string;
}): AssetCsvPreview => {
  const parsedRows = parseCsvText(csvText);
  const headers = parsedRows[0]?.map(normalizeCsvHeader) ?? [];
  const dataRows = parsedRows.slice(1);

  if (!headers.length || !dataRows.length) {
    throw new Error("The selected CSV must include a header row and at least one asset row.");
  }

  const categoryByCodeOrName = new Map(
    catalog.categories.flatMap((category) => [
      [category.code.trim().toLowerCase(), category.id] as const,
      [normalizeCsvLookup(category.code), category.id] as const,
      [normalizeCsvLookup(category.name), category.id] as const,
    ]),
  );
  const locationByCodeOrName = new Map(
    catalog.locations.flatMap((location) => [
      [normalizeCsvLookup(location.code), location.id] as const,
      [normalizeCsvLookup(location.name), location.id] as const,
    ]),
  );
  const defaultCategory = catalog.categories[0];

  if (!defaultCategory) {
    throw new Error("Create at least one asset category before importing assets.");
  }

  const warnings = new Set<string>();
  const errors: AssetCsvPreview["errors"] = [];
  let unmatchedWarehouseSlots = 0;
  let zeroQuantityRows = 0;
  const existingCodes = new Set(assets.map((asset) => asset.code.trim().toUpperCase()).filter(Boolean));
  const existingAssetByCode = new Map(assets.map((asset) => [asset.code.trim().toUpperCase(), asset] as const));
  const hasCategoryColumn = hasCsvColumn(headers, ["categoryId", "categoryCode", "category"]);
  const hasLegacyFolderColumn = hasCsvColumn(headers, ["Estructura de la carpeta (Carpeta)", "folderPath"]);
  const rawDrafts = dataRows.reduce<AssetCsvDraft[]>((drafts, values, index) => {
    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const rowNumber = index + 2;

    try {
      const rowIssues: string[] = [];
      const name = resolveCsvValue(row, [
        "name",
        "asset",
        "assetName",
        "Nombre (en la base de datos)",
        "Nombre (en la base de datos) 2",
        "nombre",
      ]);
      const internalCode = resolveCsvValue(row, [
        "internalCode",
        "code",
        "assetCode",
        "sku",
        "Código",
        "ID (Número de serie)",
        "Códigos QR",
      ]);

      if (!name) {
        rowIssues.push("Asset name is missing.");
      }

      if (!internalCode) {
        rowIssues.push("Asset code is missing.");
      }

      const categoryValue = resolveCsvValue(row, ["categoryId", "categoryCode", "category"]);
      const explicitLocationValue = resolveCsvValue(row, ["defaultLocationId", "locationCode", "location", "defaultLocation"]);
      const warehouseSlot = resolveCsvValue(row, ["Ubicado en almacén", "warehouseSlot", "warehouse"]);
      const categoryId = categoryValue ? categoryByCodeOrName.get(normalizeCsvLookup(categoryValue)) : undefined;
      const defaultLocationId = explicitLocationValue
        ? locationByCodeOrName.get(normalizeCsvLookup(explicitLocationValue))
        : warehouseSlot
          ? locationByCodeOrName.get(normalizeCsvLookup(warehouseSlot))
          : undefined;
      const purchasePrice = parseEditableCsvMoney(resolveCsvValue(row, ["purchasePrice", "purchase price", "precio compra", "precio de compra"]), "Purchase price", rowIssues);
      const shippingCost = parseEditableCsvMoney(resolveCsvValue(row, ["shipping", "freight", "envio", "flete"]), "Shipping", rowIssues);
      const customsCost = parseEditableCsvMoney(resolveCsvValue(row, ["customs", "customsTax", "taxes", "impuestos", "aduana"]), "Customs/taxes", rowIssues);
      const explicitAdditionalCosts = parseEditableCsvMoney(resolveCsvValue(row, ["additionalCosts", "additional costs", "gastos adicionales"]), "Additional costs", rowIssues);
      const additionalCosts =
        typeof explicitAdditionalCosts === "number"
          ? explicitAdditionalCosts
          : [shippingCost, customsCost].some((value) => typeof value === "number")
            ? (shippingCost ?? 0) + (customsCost ?? 0)
            : undefined;
      const replacementValue = parseEditableCsvMoney(resolveCsvValue(row, ["replacementValue", "replacement", "replacement value", "value", "valor reposicion", "valor de reposicion"]), "Replacement value", rowIssues);
      const currentBookValue = parseEditableCsvMoney(resolveCsvValue(row, ["currentBookValue", "current book value", "current value", "insured value", "valor asegurado", "valor actual"]), "Current value", rowIssues);
      const conditionStatus = resolveCsvValue(row, ["condition", "conditionStatus"]) || "Good";
      const safeConditionStatus = allowedCsvConditions.has(conditionStatus) ? conditionStatus : "Review";
      const totalQuantity = parseEditableCsvQuantity(resolveCsvValue(row, ["quantity", "Cantidad actual", "currentQuantity"]), rowIssues);
      const folderPath = resolveCsvValue(row, ["Estructura de la carpeta (Carpeta)", "folderPath"]);
      const folderType = resolveCsvValue(row, ["Tipo de articulo (Carpeta)", "folderType"]);
      const positionType = resolveCsvValue(row, ["Tipo (posición/case/set)", "positionType"]);
      const externalNote = resolveCsvValue(row, ["Nota externa", "externalNote", "notes"]);
      const serialNumber = resolveCsvValue(row, ["serialNumber", "serial", "Número de Serie (Número de serie)"]);

      if (categoryValue && !categoryId) {
        warnings.add(`Unknown category "${categoryValue}" will use ${defaultCategory.name}.`);
      }

      if (explicitLocationValue && !defaultLocationId) {
        warnings.add(`Unknown location "${explicitLocationValue}" will be left blank.`);
      }

      if (!explicitLocationValue && warehouseSlot && !defaultLocationId) {
        unmatchedWarehouseSlots += 1;
      }

      if (!allowedCsvConditions.has(conditionStatus)) {
        rowIssues.push("Condition was not recognized and was set to Review.");
      }

      if (totalQuantity === 0) {
        zeroQuantityRows += 1;
      }

      drafts.push({
        importRowNumber: rowNumber,
        name,
        internalCode: internalCode.toUpperCase(),
        categoryId: categoryId ?? defaultCategory.id,
        defaultLocationId,
        brand: resolveCsvValue(row, ["brand"]),
        model: resolveCsvValue(row, ["model"]),
        serialNumber,
        description: resolveCsvValue(row, ["description"]),
        conditionStatus: safeConditionStatus,
        notes: joinCsvNotes([
          externalNote,
          warehouseSlot && `Warehouse slot: ${warehouseSlot}`,
          folderPath && `Source folder: ${folderPath}`,
          folderType && `Source folder type: ${folderType}`,
          positionType && `Source item type: ${positionType}`,
        ]),
        purchasePrice,
        additionalCosts,
        replacementValue,
        currentBookValue,
        ownershipType: resolveCsvValue(row, ["ownership", "ownershipType"]) || "owned",
        qrCodeValue: resolveCsvValue(row, ["qr", "qrCode", "qrCodeValue", "barcode", "Códigos QR"]),
        totalQuantity,
        importWarnings: rowIssues,
      });
    } catch (error) {
      errors.push({
        rowNumber,
        message: getErrorMessage(error).replace(/^Row \d+:\s*/i, ""),
      });
    }

    return drafts;
  }, []);
  const { drafts, mergedDuplicateRows, duplicateGroups, ambiguousQuantityGroups } = aggregateAssetCsvDrafts(rawDrafts);
  const importableDrafts = drafts.filter((draft) => !existingCodes.has(draft.internalCode.trim().toUpperCase()));
  const existingMatches = drafts
    .map((draft) => {
      const existingAsset = existingAssetByCode.get(draft.internalCode.trim().toUpperCase());

      if (!existingAsset) {
        return null;
      }

      return {
        code: draft.internalCode,
        csvName: draft.name,
        existingName: existingAsset.name,
        existingStock: existingAsset.totalQuantity,
        category: existingAsset.category,
        location: existingAsset.location,
      };
    })
    .filter((match): match is NonNullable<typeof match> => Boolean(match));
  const stockSource = mergedDuplicateRows ? "declaredQuantity" : "mergedRows";

  if (unmatchedWarehouseSlots) {
    warnings.add(
      `${unmatchedWarehouseSlots} warehouse slot value${unmatchedWarehouseSlots === 1 ? "" : "s"} will be preserved in notes.`,
    );
  }

  if (!hasCategoryColumn && hasLegacyFolderColumn) {
    warnings.add(`No category column found. Imported assets will use ${defaultCategory.name}.`);
  }

  if (zeroQuantityRows) {
    warnings.add(`${zeroQuantityRows} row${zeroQuantityRows === 1 ? "" : "s"} have zero quantity.`);
  }

  if (duplicateGroups) {
    warnings.add(
      `${duplicateGroups} duplicate code group${duplicateGroups === 1 ? "" : "s"} will keep the safest stock count from declared quantity or row count.`,
    );
  }

  if (ambiguousQuantityGroups) {
    warnings.add(
      `${ambiguousQuantityGroups} duplicate group${ambiguousQuantityGroups === 1 ? "" : "s"} have mixed quantities. Review stock before importing.`,
    );
  }

  const editableIssueRows = drafts.filter((draft) => draft.importWarnings?.length).length;
  if (editableIssueRows) {
    warnings.add(`${editableIssueRows} row${editableIssueRows === 1 ? "" : "s"} need review in the editable import table.`);
  }

  return {
    fileName,
    drafts,
    existingMatches,
    errors,
    summary: {
      totalRows: dataRows.length,
      uniqueCodes: drafts.length,
      duplicateRows: mergedDuplicateRows,
      existingCodes: drafts.length - importableDrafts.length,
      importableCount: importableDrafts.length,
      importableStock: importableDrafts.reduce((total, draft) => total + draft.totalQuantity, 0),
      allRowsExist: drafts.length > 0 && importableDrafts.length === 0,
      stockSource,
      warnings: Array.from(warnings),
    },
  };
};

const buildAssetCsvIssueReport = (preview: AssetCsvPreview) => {
  const lines = [
    `Asset CSV import report: ${preview.fileName}`,
    `Rows: ${preview.summary.totalRows}`,
    `Unique assets: ${preview.summary.uniqueCodes}`,
    `To import: ${preview.summary.importableCount}`,
    `Existing codes skipped: ${preview.summary.existingCodes}`,
    `Duplicate rows merged: ${preview.summary.duplicateRows}`,
    `Stock rule: ${preview.summary.stockSource === "declaredQuantity" ? "declared quantity with duplicate safety checks" : "CSV row count"}`,
    preview.summary.allRowsExist ? "Result: all assets in this CSV already exist. Import is disabled to avoid duplicates." : "",
    "",
  ].filter((line) => line !== "");

  if (preview.existingMatches.length) {
    lines.push("Existing matches");
    preview.existingMatches.slice(0, 40).forEach((match) => {
      lines.push(
        `- ${match.code}: CSV "${match.csvName}" matched "${match.existingName}" (${match.existingStock} unit${match.existingStock === 1 ? "" : "s"}, ${match.category}, ${match.location})`,
      );
    });
    if (preview.existingMatches.length > 40) {
      lines.push(`- ${preview.existingMatches.length - 40} more existing match(es).`);
    }
    lines.push("");
  }

  if (preview.errors.length) {
    lines.push("Errors");
    preview.errors.forEach((error) => {
      lines.push(`- Row ${error.rowNumber}: ${error.message}`);
    });
    lines.push("");
  }

  const editableRows = preview.drafts.filter((draft) => draft.importWarnings?.length);
  if (editableRows.length) {
    lines.push("Rows reviewed in app");
    editableRows.forEach((draft) => {
      lines.push(`- Row ${draft.importRowNumber} (${draft.internalCode || "No code"}): ${draft.importWarnings?.join(" ")}`);
    });
    lines.push("");
  }

  if (preview.summary.warnings.length) {
    lines.push("Warnings");
    preview.summary.warnings.forEach((warning) => {
      lines.push(`- ${warning}`);
    });
  }

  return lines.join("\n").trim();
};

export const AssetsPage = ({ projectId = null, projectName = null }: AssetsPageProps) => (
  <AssetsContent projectId={projectId} projectName={projectName} />
);

const AssetsContent = ({ projectId, projectName }: AssetsPageProps) => {
  const { activeWorkspaceId } = useWorkspace();
  const { projects, refreshProjects } = useShellContext();
  const { addItems } = useCompareTray();
  const isProjectMode = Boolean(projectId);
  const assetControls = useListControls<AssetSortField, AssetListQuery>({
    viewKey: isProjectMode ? "project-assets-list" : "assets-list",
    defaults: {
      search: "",
      sortBy: "name",
      sortDirection: "asc",
    },
    sortOptions: assetSortOptions,
    defaultDirectionBySort: {
      createdAt: "desc",
      updatedAt: "desc",
      incidentsOpen: "desc",
    },
    buildQuery: ({ search, sortBy, sortDirection }) => ({
      workspaceId: activeWorkspaceId,
      scopeProjectId: projectId,
      search,
      sortBy,
      sortDirection,
    }),
  });
  const { data: assets, error, isLoading, reload } = useAssetsList(assetControls.query);
  const { data: catalog, error: catalogError } = useCatalogData({
    workspaceId: activeWorkspaceId,
    entityType: "location",
    search: "",
    sortBy: "name",
    sortDirection: "asc",
  });
  const navigate = useNavigate();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [cartItemsById, setCartItemsById] = useState<Record<string, AssetOperationCartItem>>({});
  const [actionPanelOpen, setActionPanelOpen] = useState(false);
  const [packingPanelOpen, setPackingPanelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [packingError, setPackingError] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);
  const toast = useToast();
  const [assignNextStep, setAssignNextStep] = useState<{ projectId: string; projectName: string } | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isSubmittingPacking, setIsSubmittingPacking] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSubmittingEditor, setIsSubmittingEditor] = useState(false);
  const [isArchivingAsset, setIsArchivingAsset] = useState(false);
  const [isUploadingPreviewImages, setIsUploadingPreviewImages] = useState(false);
  const [openingPreviewImageId, setOpeningPreviewImageId] = useState<string | null>(null);
  const [isImportingAssets, setIsImportingAssets] = useState(false);
  const [csvImportPreview, setCsvImportPreview] = useState<AssetCsvPreview | null>(null);
  const [csvShowAllRows, setCsvShowAllRows] = useState(false);
  const [csvReportCopied, setCsvReportCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const editorAssetId = editorMode === "edit" ? selectedAssetId ?? undefined : undefined;
  const { data: editorDetail, reload: reloadEditorDetail } = useAssetDetail(editorAssetId);
  const { data: selectedAssetDetail, reload: reloadSelectedAssetDetail } = useAssetDetail(selectedAssetId ?? undefined);

  const activeAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );
  const activeAssetImages = useMemo(
    () =>
      selectedAssetDetail.files
        .filter((file) => file.status === "available" && file.mimeType.startsWith("image/"))
        .slice(0, 2),
    [selectedAssetDetail.files],
  );
  const activeAssetImageSlots = Math.max(0, 2 - activeAssetImages.length);
  const selectedRowIds = useMemo(() => Object.keys(cartItemsById), [cartItemsById]);
  const selectedAssets = useMemo(() => selectedRowIds.map((assetId) => cartItemsById[assetId]).filter(Boolean), [cartItemsById, selectedRowIds]);
  const selectedAssetSelections = useMemo(
    () =>
      selectedAssets.map((asset) => ({
        assetId: asset.id,
        quantity: asset.requestedQuantity,
      })),
    [selectedAssets],
  );
  const csvDerivedSummary = useMemo(
    () => (csvImportPreview ? buildAssetCsvDerivedSummary(csvImportPreview, assets) : null),
    [assets, csvImportPreview],
  );
  const csvReviewDrafts = csvShowAllRows
    ? csvDerivedSummary?.importableDrafts ?? []
    : csvDerivedSummary?.importableDrafts.slice(0, 8) ?? [];
  const csvHiddenReviewCount = Math.max(0, (csvDerivedSummary?.importableDrafts.length ?? 0) - csvReviewDrafts.length);
  const selectedKitLockedAssets = useMemo(
    () => selectedAssets.filter((asset) => asset.linkedKitCount > 0),
    [selectedAssets],
  );
  const selectedKitLockSummary = useMemo(() => {
    if (!selectedKitLockedAssets.length) {
      return null;
    }

    return selectedKitLockedAssets
      .map((asset) => `${asset.code} (${asset.linkedKitCodes.join(", ")})`)
      .join(", ");
  }, [selectedKitLockedAssets]);

  useEffect(() => {
    if (!assets.length) {
      return;
    }

    setCartItemsById((current) => {
      let changed = false;
      const nextItems = { ...current };

      assets.forEach((asset) => {
        const currentItem = current[asset.id];
        if (!currentItem) {
          return;
        }

        nextItems[asset.id] = buildOperationCartItem(asset, currentItem.requestedQuantity);
        changed = true;
      });

      return changed ? nextItems : current;
    });
  }, [assets]);

  const handleCartSelectionChange = (nextSelectedRowIds: string[]) => {
    const visibleAssetById = new Map(assets.map((asset) => [asset.id, asset] as const));
    const nextSelected = new Set(nextSelectedRowIds);

    setCartItemsById((current) => {
      const nextItems: Record<string, AssetOperationCartItem> = {};

      Object.entries(current).forEach(([assetId, item]) => {
        if (nextSelected.has(assetId)) {
          nextItems[assetId] = item;
        }
      });

      nextSelectedRowIds.forEach((assetId) => {
        const visibleAsset = visibleAssetById.get(assetId);
        if (visibleAsset) {
          nextItems[assetId] = buildOperationCartItem(visibleAsset, current[assetId]?.requestedQuantity);
        }
      });

      return nextItems;
    });
  };

  const updateCartQuantity = (assetId: string, quantity: number) => {
    setCartItemsById((current) => {
      const item = current[assetId];
      if (!item) {
        return current;
      }

      return {
        ...current,
        [assetId]: buildOperationCartItem(item, quantity),
      };
    });
  };

  const updateCartSelections = (selections: Array<{ assetId: string; quantity: number }>) => {
    setCartItemsById((current) => {
      const nextItems = { ...current };

      selections.forEach((selection) => {
        const item = nextItems[selection.assetId];
        if (item) {
          nextItems[selection.assetId] = buildOperationCartItem(item, selection.quantity);
        }
      });

      return nextItems;
    });
  };

  const removeFromCart = (assetId: string) => {
    setCartItemsById((current) => {
      const { [assetId]: _removed, ...nextItems } = current;
      return nextItems;
    });
  };

  const clearOperationCart = () => {
    setCartItemsById({});
    setAssignNextStep(null);
  };

  const handleAssignMove = async (formValue: AssetAssignMoveFormValue) => {
    try {
      setIsSubmittingAction(true);
      const result = await assignMoveAssets({
        commandId: crypto.randomUUID(),
        workspaceId: activeWorkspaceId,
        assetIds: selectedRowIds,
        assetSelections: formValue.assetSelections,
        mode: formValue.mode,
        projectId: formValue.projectId,
        projectUnitId: formValue.projectUnitId,
        departmentId: formValue.departmentId,
        assignedToUserId: formValue.assignedToUserId,
        targetLocationId: formValue.targetLocationId,
        expectedReturnAt: formValue.expectedReturnAt ? new Date(formValue.expectedReturnAt).toISOString() : undefined,
        notes: formValue.notes,
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), refreshProjects()]);
      setActionError(null);
      toast.success("Done", result.summary);
      setActionWarning(result.warningSummary ?? null);
      setActionPanelOpen(false);
      if (formValue.mode === "assign" && formValue.projectId) {
        const assignedProject = projects.find((project) => project.id === formValue.projectId);
        setAssignNextStep({
          projectId: formValue.projectId,
          projectName: assignedProject?.name ?? "this project",
        });
      } else {
        clearOperationCart();
      }
    } catch (nextError) {
      setActionError(getUserFacingErrorMessage(nextError, "Unable to apply assign or move."));
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleCreatePackingSlip = async (formValue: PackingSlipBuilderDraft) => {
    try {
      setIsSubmittingPacking(true);
      const result = await createPackingSlip({
        commandId: crypto.randomUUID(),
        workspaceId: activeWorkspaceId,
        assetIds: selectedRowIds,
        assetSelections: formValue.assetSelections,
        projectId: formValue.projectId,
        projectUnitId: formValue.projectUnitId,
        departmentId: formValue.departmentId,
        responsibleUserId: formValue.responsibleUserId,
        returnDueAt: formValue.returnDueAt ? new Date(formValue.returnDueAt).toISOString() : undefined,
        notes: formValue.notes,
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), refreshProjects()]);
      writePreference(uiPreferenceKeys.activePackingSlipId, result.packingSlipId);
      setPackingError(null);
      toast.success("Done", result.summary);
      setActionWarning(null);
      setAssignNextStep(null);
      setPackingPanelOpen(false);
      clearOperationCart();
      navigate("/packing-slips");
    } catch (nextError) {
      setPackingError(getUserFacingErrorMessage(nextError, "Unable to issue packing slip."));
    } finally {
      setIsSubmittingPacking(false);
    }
  };

  const handleSubmitAssetEditor = async (formValue: AssetEditorDraft) => {
    try {
      setIsSubmittingEditor(true);

      if (editorMode === "edit" && editorAssetId) {
        const result = await updateAsset({
          commandId: crypto.randomUUID(),
          workspaceId: activeWorkspaceId,
          assetId: editorAssetId,
          actorType: "user",
          sourceChannel: "desktop",
          isActive: true,
          ...formValue,
        });

        await Promise.all([reload(), refreshProjects(), reloadEditorDetail()]);
        toast.success("Done", result.summary);
        setActionWarning(null);
      } else {
        const result = await createAsset({
          commandId: crypto.randomUUID(),
          workspaceId: activeWorkspaceId,
          actorType: "user",
          sourceChannel: "desktop",
          isActive: true,
          ...formValue,
        });

        await Promise.all([reload(), refreshProjects()]);
        setSelectedAssetId(result.assetId);
        toast.success("Done", result.summary);
        setActionWarning(null);
      }

      setEditorError(null);
      setEditorMode(null);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, "Unable to save asset changes."));
    } finally {
      setIsSubmittingEditor(false);
    }
  };

  const handleArchiveAsset = async () => {
    if (!editorAssetId) {
      return;
    }

    try {
      setIsArchivingAsset(true);
      const result = await archiveAsset({
        commandId: crypto.randomUUID(),
        workspaceId: activeWorkspaceId,
        assetId: editorAssetId,
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), refreshProjects()]);
      setEditorMode(null);
      setSelectedAssetId(null);
      setEditorError(null);
      toast.success("Done", result.summary);
      setActionWarning(null);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, "Unable to archive asset."));
    } finally {
      setIsArchivingAsset(false);
    }
  };

  const handleImportCsvFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    try {
      setEditorError(null);

      setActionWarning(null);
      const csvText = await file.text();
      setCsvImportPreview(buildAssetCsvPreview({ assets, catalog, csvText, fileName: file.name }));
      setCsvShowAllRows(false);
    } catch (error) {
      setCsvImportPreview(null);
      setEditorError(getUserFacingErrorMessage(error, "Asset CSV import failed."));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleConfirmCsvImport = async (mode: "all" | "ready" = "all") => {
    if (!csvImportPreview) {
      return;
    }

    try {
      setIsImportingAssets(true);
      setEditorError(null);

      setActionWarning(null);
      const existingCodes = new Set(assets.map((asset) => asset.code.trim().toUpperCase()).filter(Boolean));
      const readyRowNumbers =
        mode === "ready"
          ? new Set((csvDerivedSummary?.readyDrafts ?? []).map((draft) => draft.importRowNumber))
          : null;
      let importedCount = 0;
      let skippedDuplicateCount = 0;
      let skippedReviewCount = 0;

      for (const draft of csvImportPreview.drafts) {
        const { importRowNumber, importWarnings: _importWarnings, ...assetDraft } = draft;
        const normalizedCode = assetDraft.internalCode.trim().toUpperCase();

        if (readyRowNumbers && !readyRowNumbers.has(importRowNumber)) {
          skippedReviewCount += 1;
          continue;
        }

        if (existingCodes.has(normalizedCode)) {
          skippedDuplicateCount += 1;
          continue;
        }

        try {
          await createAsset({
            commandId: crypto.randomUUID(),
            workspaceId: activeWorkspaceId,
            actorType: "user",
            sourceChannel: "desktop",
            isActive: true,
            ...assetDraft,
          });
          importedCount += 1;
          existingCodes.add(normalizedCode);
        } catch (error) {
          if (isDuplicateRegistryCodeError(error)) {
            skippedDuplicateCount += 1;
            existingCodes.add(normalizedCode);
            continue;
          }

          throw new Error(
            `CSV row ${importRowNumber} could not be imported: ${
              getErrorMessage(error) || "Unknown asset import error."
            }`,
          );
        }
      }

      await Promise.all([reload(), refreshProjects()]);
      if (readyRowNumbers && skippedReviewCount) {
        setCsvImportPreview((current) =>
          current
            ? {
                ...current,
                drafts: current.drafts.filter((draft) => !readyRowNumbers.has(draft.importRowNumber)),
              }
            : current,
        );
        setCsvShowAllRows(false);
      } else {
        setCsvImportPreview(null);
        setCsvShowAllRows(false);
      }
      toast.success(
        "CSV imported",
        `Imported ${importedCount} asset${importedCount === 1 ? "" : "s"} from ${csvImportPreview.fileName}.${
          csvImportPreview.summary.duplicateRows
            ? ` Merged ${csvImportPreview.summary.duplicateRows} duplicate CSV row${
                csvImportPreview.summary.duplicateRows === 1 ? "" : "s"
              }.`
            : ""
        }${
          skippedDuplicateCount ? ` Skipped ${skippedDuplicateCount} existing code${skippedDuplicateCount === 1 ? "" : "s"}.` : ""
        }${
          skippedReviewCount ? ` Left ${skippedReviewCount} row${skippedReviewCount === 1 ? "" : "s"} for review.` : ""
        }`,
      );
    } catch (error) {
      setEditorError(getUserFacingErrorMessage(error, "Asset CSV import failed."));
    } finally {
      setIsImportingAssets(false);
    }
  };

  const handleCopyCsvIssueReport = async () => {
    if (!csvImportPreview) {
      return;
    }

    await navigator.clipboard.writeText(buildAssetCsvIssueReport(csvImportPreview));
    setCsvReportCopied(true);
    window.setTimeout(() => setCsvReportCopied(false), 1800);
  };

  const updateCsvDraft = (importRowNumber: number, patch: Partial<AssetCsvDraft>) => {
    setCsvImportPreview((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        drafts: current.drafts.map((draft) => {
          if (draft.importRowNumber !== importRowNumber) {
            return draft;
          }

          const importWarnings = (draft.importWarnings ?? []).filter((warning) => {
            if ("name" in patch && warning === "Asset name is missing.") {
              return false;
            }

            if ("internalCode" in patch && warning === "Asset code is missing.") {
              return false;
            }

            if ("totalQuantity" in patch && warning.startsWith("Quantity could not be read.")) {
              return false;
            }

            if ("purchasePrice" in patch && warning.startsWith("Purchase price could not be read")) {
              return false;
            }

            if ("additionalCosts" in patch && warning.startsWith("Additional costs could not be read")) {
              return false;
            }

            if ("currentBookValue" in patch && warning.startsWith("Current value could not be read")) {
              return false;
            }

            return true;
          });

          return {
            ...draft,
            ...patch,
            importWarnings,
          };
        }),
      };
    });
  };

  const handleCsvTextEdit =
    (importRowNumber: number, field: keyof Pick<AssetCsvDraft, "name" | "internalCode" | "serialNumber">) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = field === "internalCode" ? event.target.value.toUpperCase() : event.target.value;
      updateCsvDraft(importRowNumber, { [field]: value } as Partial<AssetCsvDraft>);
    };

  const handleCsvSelectEdit =
    (importRowNumber: number, field: keyof Pick<AssetCsvDraft, "categoryId" | "defaultLocationId">) =>
    (event: ChangeEvent<HTMLSelectElement>) => {
      updateCsvDraft(importRowNumber, { [field]: event.target.value || undefined } as Partial<AssetCsvDraft>);
    };

  const handleCsvQuantityEdit = (importRowNumber: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const parsedQuantity = Number.parseInt(event.target.value, 10);
    updateCsvDraft(importRowNumber, {
      totalQuantity: Number.isInteger(parsedQuantity) ? parsedQuantity : 0,
    });
  };

  const handleCsvOptionalMoneyEdit =
    (
      importRowNumber: number,
      field: keyof Pick<AssetCsvDraft, "purchasePrice" | "additionalCosts" | "currentBookValue">,
    ) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const rawValue = event.target.value.trim();
      const parsedValue = Number(rawValue);
      updateCsvDraft(importRowNumber, {
        [field]: rawValue && Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : undefined,
      } as Partial<AssetCsvDraft>);
    };

  const handleCsvNotesEdit = (importRowNumber: number) => (event: ChangeEvent<HTMLTextAreaElement>) => {
    updateCsvDraft(importRowNumber, { notes: event.target.value });
  };

  const assetColumns = useMemo(
    () => [
      {
        key: "asset",
        label: "Asset",
        width: 280,
        minWidth: 220,
        render: (row: (typeof assets)[number]) => (
          <div className="identity-cell">
            <span className="identity-title">{row.name}</span>
            <span className="identity-meta">{row.code}</span>
            {row.linkedKitCount ? (
              <span className="identity-meta asset-kit-membership-inline">
                In kit {row.linkedKitCodes.join(", ")}
              </span>
            ) : null}
          </div>
        ),
      },
      { key: "category", label: "Category", width: 160, minWidth: 132, render: (row: (typeof assets)[number]) => row.category },
      {
        key: "quantity",
        label: "Stock",
        width: 188,
        minWidth: 164,
        render: (row: (typeof assets)[number]) => (
          <span className="stock-inline-text">
            {formatAssetStockInline({
              availableQuantity: row.quantity,
              assignedQuantity: row.assignedQuantity,
              checkedOutQuantity: row.checkedOutQuantity,
            })}
          </span>
        ),
      },
      { key: "tracking", label: "Tracking", width: 110, minWidth: 96, render: (row: (typeof assets)[number]) => row.tracking },
      { key: "status", label: "Status", width: 112, minWidth: 96, render: (row: (typeof assets)[number]) => row.status },
      { key: "condition", label: "Condition", width: 112, minWidth: 96, render: (row: (typeof assets)[number]) => row.condition },
      { key: "custody", label: "Custody", width: 112, minWidth: 96, render: (row: (typeof assets)[number]) => row.custody },
      { key: "location", label: "Location", width: 190, minWidth: 150, render: (row: (typeof assets)[number]) => row.location },
      { key: "project", label: "Project", width: 170, minWidth: 140, render: (row: (typeof assets)[number]) => row.project },
      { key: "projectUnit", label: "Unit", width: 150, minWidth: 124, render: (row: (typeof assets)[number]) => row.projectUnit },
      { key: "responsible", label: "Responsible", width: 160, minWidth: 132, render: (row: (typeof assets)[number]) => row.responsible },
      { key: "serialNumber", label: "Serial", width: 150, minWidth: 120, render: (row: (typeof assets)[number]) => row.serialNumber },
      { key: "qrCode", label: "QR", width: 130, minWidth: 108, render: (row: (typeof assets)[number]) => row.qrCode },
      { key: "purchasePrice", label: "Purchase price", align: "right" as const, width: 132, minWidth: 112, render: (row: (typeof assets)[number]) => row.purchasePrice },
      { key: "additionalCosts", label: "Additional costs", align: "right" as const, width: 140, minWidth: 120, render: (row: (typeof assets)[number]) => row.additionalCosts },
      { key: "currentBookValue", label: "Current value", align: "right" as const, width: 132, minWidth: 112, render: (row: (typeof assets)[number]) => row.currentBookValue },
      { key: "replacementValue", label: "Replacement value", align: "right" as const, width: 148, minWidth: 124, render: (row: (typeof assets)[number]) => row.replacementValue },
      { key: "warehouseSlot", label: "Warehouse", width: 126, minWidth: 108, render: (row: (typeof assets)[number]) => row.warehouseSlot },
      { key: "folderPath", label: "Folder path", width: 250, minWidth: 200, render: (row: (typeof assets)[number]) => row.folderPath },
      { key: "hasAccessories", label: "Accessories", width: 110, minWidth: 96, render: (row: (typeof assets)[number]) => row.hasAccessories },
      { key: "source", label: "Source", width: 176, minWidth: 150, render: (row: (typeof assets)[number]) => row.source },
      { key: "incidents", label: "Open issues", align: "right" as const, width: 96, minWidth: 84, render: (row: (typeof assets)[number]) => row.incidentsOpen },
    ],
    [assets],
  );

  return (
    <div className="page-stack assets-page-stack">
      <SectionHeader
        title={isProjectMode ? "Project assets" : "Assets"}
        body={
          isProjectMode
            ? "The gear assigned or available to this project. Click any row to see its history and status."
            : "Every piece of equipment your team owns. Filter, search or import from CSV to build the catalog."
        }
      />

      {error ? <div className="empty-state">Assets unavailable: {error}</div> : null}
      {!error && isLoading ? (
        <SurfaceCard title={isProjectMode ? "Project Assets" : "Assets"}>
          <TableSkeleton
            body={isProjectMode ? "Loading assets linked to this project." : "Loading assets."}
            columns={6}
          />
        </SurfaceCard>
      ) : null}

      {catalogError ? <div className="action-feedback action-feedback-error">Catalog unavailable: {catalogError}</div> : null}
      {assignNextStep && selectedRowIds.length ? (
        <div className="selection-action-bar asset-next-step-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">Ready for checkout</span>
            <span className="selection-action-subtitle">
              These assets are reserved for {assignNextStep.projectName}. Create the packing slip when the gear is physically leaving.
            </span>
          </div>
          <div className="selection-action-buttons">
            <button
              className="action-primary-button action-row-button"
              onClick={() => {
                setPackingPanelOpen(true);
                setActionPanelOpen(false);
                setPackingError(null);
              }}
              type="button"
            >
              <ClipboardList size={14} />
              <span>Create packing slip for this project</span>
            </button>
            <button
              className="ghost-control action-row-button"
              onClick={() => navigate(`/projects/${assignNextStep.projectId}/assets`)}
              type="button"
            >
              Open Project Assets
            </button>
          </div>
        </div>
      ) : null}
      {actionWarning ? <div className="action-feedback action-feedback-warning">{actionWarning}</div> : null}
      {editorError && !editorMode ? <div className="action-feedback action-feedback-error">{editorError}</div> : null}
      {selectedKitLockSummary ? (
        <div className="action-feedback action-feedback-warning">
          These assets are part of active kits and cannot be assigned or moved individually: {selectedKitLockSummary}. Remove them from the kit first if you need to operate them as standalone items.
        </div>
      ) : null}

      {!error && !isLoading && assets.length === 0 ? (
        <GuidedEmptyState
          title={isProjectMode ? "No assets are assigned to this project yet" : "Your asset registry is still empty"}
          body={
            isProjectMode
              ? "This project does not have assets yet."
              : "Create the first asset once your catalog is ready."
          }
          tips={
            isProjectMode
              ? ["Assign existing assets into this project", "Use bulk assign or move when you are ready"]
              : ["Set locations and categories in Catalog first", "Then create assets with code, status and custody"]
          }
          actionLabel={isProjectMode ? "Open global assets" : "Create first asset"}
          onAction={() => {
            if (isProjectMode) {
              navigate("/assets");
              return;
            }

            setEditorMode("create");
            setEditorError(null);
          }}
          secondaryActionLabel="Open Catalog"
          onSecondaryAction={() => navigate("/catalog")}
        />
      ) : null}

      {actionPanelOpen && selectedRowIds.length ? (
        <AssetAssignMovePanel
          defaultProjectId={isProjectMode ? projectId ?? null : null}
          departments={catalog.departments}
          error={actionError}
          initialAssetSelections={selectedAssetSelections}
          isSubmitting={isSubmittingAction}
          locations={catalog.locations}
          onAssetSelectionsChange={updateCartSelections}
          onClose={() => {
            setActionPanelOpen(false);
            setActionError(null);
          }}
              onSubmit={handleAssignMove}
              projects={projects}
              selectedAssets={selectedAssets}
              selectedCount={selectedRowIds.length}
              users={catalog.users}
            />
      ) : null}

      {packingPanelOpen && selectedRowIds.length ? (
        <PackingSlipBuilderPanel
          defaultProjectId={assignNextStep?.projectId ?? (isProjectMode ? projectId ?? null : null)}
          departments={catalog.departments}
          error={packingError}
          initialAssetSelections={selectedAssetSelections}
          isSubmitting={isSubmittingPacking}
          onAssetSelectionsChange={updateCartSelections}
          onClose={() => {
            setPackingPanelOpen(false);
            setPackingError(null);
          }}
          onSubmit={handleCreatePackingSlip}
          projects={projects}
          selectedAssets={selectedAssets}
          selectedCount={selectedRowIds.length}
          users={catalog.users}
        />
      ) : null}

      {editorMode ? (
        <AssetEditorPanel
          key={`${editorMode}-${editorAssetId ?? "new"}-${editorDetail.editor?.id ?? "empty"}`}
          categories={catalog.categories}
          error={editorError}
          initialValue={editorMode === "edit" ? editorDetail.editor : null}
          isArchiving={isArchivingAsset}
          isSubmitting={isSubmittingEditor}
          locations={catalog.locations}
          mode={editorMode}
          onArchive={editorMode === "edit" ? handleArchiveAsset : undefined}
          onClose={() => {
            setEditorMode(null);
            setEditorError(null);
          }}
          onSubmit={handleSubmitAssetEditor}
        />
      ) : null}

      {!isProjectMode ? <GlobalAssetsMetrics /> : null}

      <ResizableSideRailLayout
        className="asset-list-layout"
        defaultWidth={360}
        maxWidth={560}
        minWidth={300}
        storageKey={uiPreferenceKeys.assetOperationSideRailWidth}
      >
        <SurfaceCard
          className="asset-registry-card"
          title={isProjectMode ? "Assets" : "Assets"}
          aside={
            <div className="asset-registry-header-actions">
              <button
                className="asset-create-button action-row-button"
                onClick={() => {
                  setEditorMode("create");
                  setEditorError(null);
                }}
                type="button"
              >
                <Plus size={14} />
                <span>New asset</span>
              </button>
              <button
                className="ghost-control action-row-button"
                disabled={isImportingAssets}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <FileUp size={14} />
                <span>{isImportingAssets ? "Importing..." : "Import CSV"}</span>
              </button>
              <input
                ref={fileInputRef}
                accept=".csv,text/csv"
                hidden
                onChange={(event) => void handleImportCsvFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </div>
          }
        >
          <ListToolbar
            activeSortLabel={assetControls.activeSortOption?.label}
            onSearchValueChange={assetControls.setSearchValue}
            onSortByChange={assetControls.setSortField}
            onToggleSortDirection={assetControls.toggleSortDirection}
            resultCount={assets.length}
            resultLabel="assets"
            searchPlaceholder={isProjectMode ? "Search assets, codes, units or QR" : "Search assets, codes, locations or QR"}
            searchValue={assetControls.searchValue}
            sortBy={assetControls.sortBy}
            sortDirection={assetControls.sortDirection}
            sortOptions={assetSortOptions}
          />
          {csvImportPreview ? (
            <div className={`asset-import-preview${csvImportPreview.errors.length ? " has-errors" : ""}`}>
              <div className="asset-import-preview-header">
                <div className="asset-import-preview-copy">
                  <span className="asset-import-preview-kicker">CSV preview</span>
                  <strong>{csvImportPreview.fileName}</strong>
                  <span>
                    Stock uses {csvImportPreview.summary.stockSource === "declaredQuantity" ? "declared quantities" : "row count"} with duplicate checks.
                  </span>
                </div>
                <div className="asset-import-preview-actions">
                  {csvImportPreview.errors.length || csvImportPreview.summary.warnings.length ? (
                    <button
                      className="ghost-control action-row-button"
                      onClick={() => void handleCopyCsvIssueReport()}
                      type="button"
                    >
                      <ClipboardList size={14} />
                      <span>{csvReportCopied ? "Copied" : "Copy report"}</span>
                    </button>
                  ) : null}
                  <button
                    className="ghost-control cancel-control action-row-button"
                    disabled={isImportingAssets}
                    onClick={() => {
                      setCsvImportPreview(null);
                      setCsvShowAllRows(false);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  {csvDerivedSummary?.validationIssues.length && csvDerivedSummary.readyDrafts.length ? (
                    <button
                      className="ghost-control action-row-button"
                      disabled={isImportingAssets}
                      onClick={() => void handleConfirmCsvImport("ready")}
                      type="button"
                    >
                      Import ready rows
                    </button>
                  ) : null}
                  <button
                    className="asset-create-button action-row-button"
                    disabled={isImportingAssets || !csvDerivedSummary?.canImport}
                    onClick={() => void handleConfirmCsvImport("all")}
                    type="button"
                  >
                    {isImportingAssets ? "Importing..." : "Import assets"}
                  </button>
                </div>
              </div>

              <div className="asset-import-preview-stats">
                {[
                  ["Rows", csvImportPreview.summary.totalRows],
                  ["Unique assets", csvImportPreview.summary.uniqueCodes],
                  ["To import", csvDerivedSummary?.importableCount ?? csvImportPreview.summary.importableCount],
                  ["Ready", csvDerivedSummary?.readyDrafts.length ?? 0],
                  ["Needs review", csvDerivedSummary?.needsReviewDrafts.length ?? 0],
                  ["Total units", csvDerivedSummary?.importableStock ?? csvImportPreview.summary.importableStock],
                  ["Existing", csvDerivedSummary?.existingCount ?? csvImportPreview.summary.existingCodes],
                  ["Merged rows", csvImportPreview.summary.duplicateRows],
                ].map(([label, value]) => (
                  <span key={label}>
                    <strong>{value}</strong>
                    {label}
                  </span>
                ))}
                <span className={csvImportPreview.summary.warnings.length ? "asset-import-stat-warning" : undefined}>
                  <strong>{csvImportPreview.summary.warnings.length}</strong>
                  warnings
                </span>
                <span className={csvImportPreview.errors.length ? "asset-import-stat-error" : undefined}>
                  <strong>{csvImportPreview.errors.length}</strong>
                  errors
                </span>
              </div>

              {csvReviewDrafts.length ? (
                <div className="asset-import-review">
                  <div className="asset-import-review-header">
                    <div>
                      <strong>Review rows before importing</strong>
                      <span>Edit operational and insurance fields here instead of going back to the CSV.</span>
                    </div>
                    <div className="asset-import-review-header-actions">
                      {csvHiddenReviewCount ? <span>{csvHiddenReviewCount} more row(s) hidden.</span> : null}
                      {(csvDerivedSummary?.importableDrafts.length ?? 0) > 8 ? (
                        <button
                          className="ghost-control action-row-button"
                          onClick={() => setCsvShowAllRows((current) => !current)}
                          type="button"
                        >
                          {csvShowAllRows ? "Show less" : "Show all"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="asset-import-review-table">
                    <div className="asset-import-review-row is-header">
                      <span>Row</span>
                      <span>Status</span>
                      <span>Asset</span>
                      <span>Code</span>
                      <span>Category</span>
                      <span>Location</span>
                      <span>Qty</span>
                      <span>Serial</span>
                      <span>Purchase</span>
                      <span>Add. costs</span>
                      <span>Current</span>
                    </div>
                    {csvReviewDrafts.map((draft) => (
                      <Fragment key={draft.importRowNumber}>
                        <div className="asset-import-review-row">
                          <span className="asset-import-review-row-number">{draft.importRowNumber}</span>
                          <span
                            className={`asset-import-row-status${
                              csvDerivedSummary?.issueCountByRow[draft.importRowNumber]
                                ? " needs-review"
                                : draft.importWarnings?.length
                                  ? " has-warning"
                                  : ""
                            }`}
                          >
                            {csvDerivedSummary?.issueCountByRow[draft.importRowNumber]
                              ? "Needs review"
                              : draft.importWarnings?.length
                                ? "Review"
                                : "Ready"}
                          </span>
                          <input
                            aria-label={`Asset name for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input"
                            onChange={handleCsvTextEdit(draft.importRowNumber, "name")}
                            value={draft.name}
                          />
                          <input
                            aria-label={`Asset code for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input asset-import-review-code"
                            onChange={handleCsvTextEdit(draft.importRowNumber, "internalCode")}
                            value={draft.internalCode}
                          />
                          <select
                            aria-label={`Category for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input"
                            onChange={handleCsvSelectEdit(draft.importRowNumber, "categoryId")}
                            value={draft.categoryId}
                          >
                            {catalog.categories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.code} · {category.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`Location for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input"
                            onChange={handleCsvSelectEdit(draft.importRowNumber, "defaultLocationId")}
                            value={draft.defaultLocationId ?? ""}
                          >
                            <option value="">No location</option>
                            {catalog.locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.code} · {location.name}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={`Quantity for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input asset-import-review-quantity"
                            min={0}
                            onChange={handleCsvQuantityEdit(draft.importRowNumber)}
                            type="number"
                            value={draft.totalQuantity}
                          />
                          <input
                            aria-label={`Serial number for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input"
                            onChange={handleCsvTextEdit(draft.importRowNumber, "serialNumber")}
                            value={draft.serialNumber}
                          />
                          <input
                            aria-label={`Purchase price for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input asset-import-review-quantity"
                            min={0}
                            onChange={handleCsvOptionalMoneyEdit(draft.importRowNumber, "purchasePrice")}
                            type="number"
                            value={draft.purchasePrice ?? ""}
                          />
                          <input
                            aria-label={`Additional costs for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input asset-import-review-quantity"
                            min={0}
                            onChange={handleCsvOptionalMoneyEdit(draft.importRowNumber, "additionalCosts")}
                            type="number"
                            value={draft.additionalCosts ?? ""}
                          />
                          <input
                            aria-label={`Current value for CSV row ${draft.importRowNumber}`}
                            className="asset-import-review-input asset-import-review-quantity"
                            min={0}
                            onChange={handleCsvOptionalMoneyEdit(draft.importRowNumber, "currentBookValue")}
                            type="number"
                            value={draft.currentBookValue ?? ""}
                          />
                        </div>
                        <textarea
                          aria-label={`Notes for CSV row ${draft.importRowNumber}`}
                          className="asset-import-review-notes"
                          onChange={handleCsvNotesEdit(draft.importRowNumber)}
                          placeholder="Notes"
                          rows={2}
                          value={draft.notes}
                        />
                        {draft.importWarnings?.length ? (
                          <div className="asset-import-review-row-note">
                            Row {draft.importRowNumber}: {draft.importWarnings.join(" ")}
                          </div>
                        ) : null}
                      </Fragment>
                    ))}
                  </div>
                </div>
              ) : null}

              {csvImportPreview.summary.allRowsExist || csvImportPreview.summary.warnings.length || csvImportPreview.errors.length || csvDerivedSummary?.validationIssues.length ? (
                <div className="asset-import-preview-issues">
                  {csvImportPreview.summary.allRowsExist ? (
                    <div className="asset-import-preview-issue-card info">
                      <strong>Nothing new to import</strong>
                      <span>All assets in this CSV already exist in this workspace.</span>
                      <span>Import is disabled to avoid duplicate asset records.</span>
                    </div>
                  ) : null}

                  {csvImportPreview.existingMatches.length ? (
                    <div className="asset-import-preview-issue-card neutral">
                      <strong>{csvImportPreview.existingMatches.length} existing match(es)</strong>
                      {csvImportPreview.existingMatches.slice(0, 5).map((match) => (
                        <span key={match.code}>
                          {match.code}: {match.existingName} · {match.existingStock} unit{match.existingStock === 1 ? "" : "s"}
                        </span>
                      ))}
                      {csvImportPreview.existingMatches.length > 5 ? (
                        <span className="asset-import-more-matches">
                          {csvImportPreview.existingMatches.length - 5} more match(es). Copy report for the full list.
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {csvImportPreview.summary.warnings.length ? (
                    <div className="asset-import-preview-issue-card warning">
                      <strong>Review before importing</strong>
                      {csvImportPreview.summary.warnings.slice(0, 4).map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                      {csvImportPreview.summary.warnings.length > 4 ? (
                        <span>{csvImportPreview.summary.warnings.length - 4} more warning(s).</span>
                      ) : null}
                    </div>
                  ) : null}

                  {csvImportPreview.errors.length ? (
                    <div className="asset-import-preview-issue-card error">
                      <strong>Fix these rows first</strong>
                      {csvImportPreview.errors.slice(0, 6).map((error) => (
                        <span key={`${error.rowNumber}-${error.message}`}>
                          Row {error.rowNumber}: {error.message}
                        </span>
                      ))}
                      {csvImportPreview.errors.length > 6 ? (
                        <span>{csvImportPreview.errors.length - 6} more row error(s).</span>
                      ) : null}
                    </div>
                  ) : null}

                  {csvDerivedSummary?.validationIssues.length ? (
                    <div className="asset-import-preview-issue-card error">
                      <strong>Review row edits</strong>
                      {csvDerivedSummary.validationIssues.slice(0, 6).map((issue) => (
                        <span key={`${issue.rowNumber}-${issue.message}`}>
                          Row {issue.rowNumber}: {issue.message}
                        </span>
                      ))}
                      {csvDerivedSummary.validationIssues.length > 6 ? (
                        <span>{csvDerivedSummary.validationIssues.length - 6} more row issue(s).</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <DataTable
            activeRowId={selectedAssetId}
            autoScrollToActiveRow
            columns={assetColumns}
            defaultVisibleColumnKeys={assetDefaultColumnKeys}
            emptyContent={
              <GuidedEmptyState
                title={
                  assetControls.searchValue
                    ? "No matches"
                    : isProjectMode
                      ? "No assets on this project yet"
                      : "No assets yet"
                }
                body={
                  assetControls.searchValue
                    ? "Try a different search, or clear it to see every asset."
                    : isProjectMode
                      ? "Assign gear from the global catalog so this project's crew can pull and return it."
                      : "Add the first piece of equipment to your catalog. You can also import from a CSV if you already have a list."
                }
                tone="subtle"
                actionLabel={assetControls.searchValue ? "Clear search" : undefined}
                onAction={assetControls.searchValue ? () => assetControls.setSearchValue("") : undefined}
                tips={
                  assetControls.searchValue
                    ? undefined
                    : isProjectMode
                      ? ["Use the assign action from the asset detail page.", "Filter the global catalog by category to find gear faster."]
                      : ["Categories and locations live in the Catalog section.", "QR labels print straight from the asset detail page."]
                }
              />
            }
            getRowId={(row) => row.id}
            maxHeight={isProjectMode ? "min(66vh, calc(100dvh - 390px), 900px)" : "min(58vh, calc(100dvh - 470px), 860px)"}
            onRowClick={(row) => setSelectedAssetId(row.id)}
            onRowDoubleClick={(row) => navigate(`/assets/${row.id}`)}
            onSortRequest={assetControls.handleColumnSortRequest}
            persistKey={isProjectMode ? "project-assets-registry-v2" : "assets-registry-v2"}
            pruneSelectionOnRowsChange={false}
            rows={assets}
            shellClassName="table-shell-wide-scroll"
            selectable
            selectedRowIds={selectedRowIds}
            sortState={
              assetControls.activeColumnKey
                ? {
                    columnKey: assetControls.activeColumnKey,
                    direction: assetControls.sortDirection,
                  }
                : null
            }
            onSelectedRowIdsChange={handleCartSelectionChange}
          />
        </SurfaceCard>

        {selectedAssets.length || activeAsset ? (
          <div className="asset-side-rail">
            <AssetOperationCart
              items={selectedAssets}
              onAddToCompare={() =>
                addItems(
                  selectedAssets.map((asset) => ({
                    id: asset.id,
                    entityType: "asset" as const,
                    label: `${asset.code} · ${asset.name}`,
                    subtitle: `${asset.location} · ${asset.project}`,
                    meta: asset.projectUnit && asset.projectUnit !== "—" ? `Unit · ${asset.projectUnit}` : undefined,
                  })),
                )
              }
              onClear={clearOperationCart}
              onCreatePackingSlip={() => {
                setPackingPanelOpen(true);
                setActionPanelOpen(false);
                setPackingError(null);

              }}
              onCreateRma={() => navigate("/incidents")}
              onOpenAssignMove={() => {
                setActionPanelOpen(true);
                setPackingPanelOpen(false);

                setAssignNextStep(null);
              }}
              onOpenAssetDetail={(assetId) => navigate(`/assets/${assetId}?report=incident`)}
              onOpenProjectReturns={isProjectMode && projectId ? () => navigate(`/projects/${projectId}/packing`) : undefined}
              onQuantityChange={updateCartQuantity}
              onRemove={removeFromCart}
            />

            {activeAsset ? (
              <SurfaceCard
                aside={
                  <button
                    aria-label="Close quick preview"
                    className="surface-card-action"
                    onClick={() => setSelectedAssetId(null)}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                }
                className="asset-quick-preview-card"
                title={activeAsset.name}
              >
                <>
                  <div className="summary-grid">
                    <div className="summary-row">
                      <span className="summary-label">Asset code</span>
                      <span className="summary-value">{activeAsset.code}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Location</span>
                      <span className="summary-value">{activeAsset.location}</span>
                    </div>
                    {formatAssetStockDetailRows({
                      totalQuantity: activeAsset.totalQuantity,
                      availableQuantity: activeAsset.quantity,
                      assignedQuantity: activeAsset.assignedQuantity,
                      checkedOutQuantity: activeAsset.checkedOutQuantity,
                    }).map((row) => (
                      <div key={row.label} className="summary-row">
                        <span className="summary-label">{row.label}</span>
                        <span className="summary-value">{row.value}</span>
                      </div>
                    ))}
                    <div className="summary-row">
                      <span className="summary-label">Project / responsible</span>
                      <span className="summary-value">
                        {activeAsset.project} · {activeAsset.responsible}
                      </span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Serial</span>
                      <span className="summary-value">
                        {activeAsset.serialNumber}
                      </span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Condition / custody</span>
                      <span className="summary-value">
                        {activeAsset.condition} · {activeAsset.custody}
                      </span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Kit membership</span>
                      <span className="summary-value">
                        {activeAsset.linkedKitCount ? activeAsset.linkedKitCodes.join(" · ") : "Standalone"}
                      </span>
                    </div>
                  </div>

                  <div className="asset-preview-image-strip">
                    {activeAssetImages.length ? (
                      activeAssetImages.map((file) => (
                        <button
                          key={file.id}
                          className="asset-preview-image-card"
                          disabled={openingPreviewImageId === file.id}
                          onClick={() => {
                            setActionError(null);
                            void (async () => {
                              try {
                                setOpeningPreviewImageId(file.id);
                                await openAssetFile(file.id);
                              } catch (nextError) {
                                setActionError(getUserFacingErrorMessage(nextError, "Unable to open that asset image."));
                                await reloadSelectedAssetDetail();
                              } finally {
                                setOpeningPreviewImageId(null);
                              }
                            })();
                          }}
                          type="button"
                        >
                          {file.previewDataUrl ? (
                            <img alt={file.originalName} src={file.previewDataUrl} />
                          ) : (
                            <span>Preview unavailable</span>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="asset-preview-image-empty">No images yet.</div>
                    )}
                  </div>

                  <div className="action-panel-actions action-panel-actions-start">
                    <button
                      className="ghost-control"
                      disabled={isUploadingPreviewImages || activeAssetImageSlots <= 0}
                      onClick={() => {
                        setActionError(null);

                        void (async () => {
                          try {
                            setIsUploadingPreviewImages(true);
                            const result = await uploadAssetImages(activeAsset.id);
                            await Promise.all([reloadSelectedAssetDetail(), reload()]);
                            toast.success("Done", result.summary);
                          } catch (nextError) {
                            setActionError(getUserFacingErrorMessage(nextError, "Unable to add images to this asset."));
                          } finally {
                            setIsUploadingPreviewImages(false);
                          }
                        })();
                      }}
                      type="button"
                    >
                      <FileUp size={14} />
                      <span>{isUploadingPreviewImages ? "Adding..." : activeAssetImageSlots <= 0 ? "2 images max" : "Add images"}</span>
                    </button>
                    <button
                      className="ghost-control"
                      onClick={() => {
                        setEditorMode("edit");
                        setEditorError(null);
                      }}
                      type="button"
                    >
                      <SquarePen size={14} />
                      <span>Edit asset</span>
                    </button>
                    <button className="action-primary-button" onClick={() => navigate(`/assets/${activeAsset.id}`)} type="button">
                      Open detail
                    </button>
                  </div>
                </>
              </SurfaceCard>
            ) : null}
          </div>
        ) : null}
      </ResizableSideRailLayout>
    </div>
  );
};

const GlobalAssetsMetrics = () => {
  const { activeWorkspaceId } = useWorkspace();
  const { data: assetsOverview, error } = useAssetsOverview({ workspaceId: activeWorkspaceId });
  const overviewCards = [
    {
      label: "Total units",
      value: assetsOverview.totalAssets,
      tone: "info" as const,
    },
    {
      label: "Reserved / out units",
      value: assetsOverview.assignedAssets,
      tone: "info" as const,
    },
    assetsOverview.cards.overdueReturns,
    assetsOverview.cards.openPackingSlips,
    assetsOverview.cards.activeIncidents,
    assetsOverview.cards.maintenanceWatch,
  ];

  return (
    <>
      {error ? <div className="action-feedback action-feedback-error">Asset metrics unavailable: {error}</div> : null}
      <div className="overview-operational-grid overview-operational-grid-assets">
        {overviewCards.map((card) => (
          <SurfaceCard key={card.label} className="overview-operational-card" title={card.label}>
            <span className={`overview-operational-value metric-tone-${card.tone}`}>{card.value}</span>
          </SurfaceCard>
        ))}
      </div>
    </>
  );
};
