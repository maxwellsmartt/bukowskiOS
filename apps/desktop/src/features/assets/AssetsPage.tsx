import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ClipboardList, FileUp, Import, Plus, SquarePen, Trash2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
import { resolveAssetAvailability, summarizeUnavailableAssets, translateAssetAvailabilityLabel, translateAssetAvailabilityReason } from "@shared/lib/assetAvailability";
import { formatAssetStockDetailRows, formatAssetStockInline } from "@shared/lib/assetQuantityPresentation";
import { presentAssetCondition, presentAssetStatus } from "@shared/lib/assetStatusPresentation";
import { cleanDisplay } from "@shared/lib/displayValue";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { AssetAssignMovePanel, type AssetAssignMoveFormValue } from "./AssetAssignMovePanel";
import { ModalShell } from "@shared/components/ModalShell";

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

type AssetsRouteState = {
  assignProjectId?: string;
  assignProjectName?: string;
};

/**
 * Sort options for the asset list. `label` here is an i18n key —
 * `ListToolbar` and any consumer renders it through `t()` so the
 * displayed string follows the user's language setting.
 */
const assetSortOptions: Array<ListSortOption<AssetSortField>> = [
  { value: "name", label: "assets.sort.name", columnKey: "asset" },
  { value: "code", label: "assets.sort.code" },
  { value: "category", label: "assets.sort.category", columnKey: "category" },
  { value: "status", label: "assets.sort.status", columnKey: "status" },
  { value: "condition", label: "assets.sort.condition", columnKey: "condition" },
  { value: "location", label: "assets.sort.location", columnKey: "location" },
  { value: "project", label: "assets.sort.project", columnKey: "project" },
  { value: "projectUnit", label: "assets.sort.projectUnit", columnKey: "projectUnit" },
  { value: "responsible", label: "assets.sort.responsible", columnKey: "responsible" },
  { value: "serialNumber", label: "assets.sort.serialNumber", columnKey: "serialNumber" },
  { value: "qrCode", label: "assets.sort.qrCode", columnKey: "qrCode" },
  { value: "incidentsOpen", label: "assets.sort.incidentsOpen", columnKey: "incidents" },
  { value: "updatedAt", label: "assets.sort.updatedAt" },
  { value: "createdAt", label: "assets.sort.createdAt" },
];

// Curated default: the columns that actually drive a decision. The rest (serial,
// tracking, custody, warehouse, costs, etc.) stay one click away in the column
// manager instead of cluttering the table with mostly-constant noise.
const assetDefaultColumnKeys = ["asset", "category", "quantity", "location", "project", "status"];

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
  const { t } = useTranslation();

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
          <span className="asset-operation-cart-kicker">{t("assets.cart.kicker")}</span>
          <strong>{t(items.length === 1 ? "assets.cart.oneSelected" : "assets.cart.manySelected", { count: items.length })}</strong>
          <span>{t(totalUnits === 1 ? "assets.cart.oneUnit" : "assets.cart.manyUnits", { count: totalUnits })}</span>
        </div>
        <button aria-label={t("assets.cart.clearAria")} className="icon-ghost-control is-danger" data-tooltip={t("assets.cart.clearTooltip")} onClick={onClear} type="button">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="asset-operation-cart-actions">
        <button className="ghost-control action-row-button" onClick={onAddToCompare} type="button">
          {t("assets.cart.addToCompare")}
        </button>
        <button
          className="ghost-control action-row-button"
          data-tooltip={singleAsset ? t("assets.cart.reportIssueSingleTip") : t("assets.cart.reportIssueMultiTip")}
          disabled={!singleAsset}
          onClick={() => singleAsset && onOpenAssetDetail(singleAsset.id)}
          type="button"
        >
          {t("assets.cart.reportIssue")}
        </button>
        <button
          className="ghost-control action-row-button"
          data-tooltip={singleAsset ? t("assets.cart.createRmaSingleTip") : t("assets.cart.createRmaMultiTip")}
          disabled={!singleAsset}
          onClick={onCreateRma}
          type="button"
        >
          {t("assets.cart.createRma")}
        </button>
        <button
          className="ghost-control action-row-button"
          disabled={issueActionsDisabled}
          onClick={onCreatePackingSlip}
          type="button"
        >
          {t("assets.cart.createPackingSlip")}
        </button>
        <button
          className="action-primary-button action-row-button"
          disabled={lockedItems.length > 0}
          onClick={onOpenAssignMove}
          type="button"
        >
          {t("assets.cart.assignMove")}
        </button>
        {onOpenProjectReturns ? (
          <button
            className="ghost-control action-row-button"
            data-tooltip={checkedOutUnits ? t("assets.cart.returnAvailableTip") : t("assets.cart.returnUnavailableTip")}
            disabled={!checkedOutUnits}
            onClick={onOpenProjectReturns}
            type="button"
          >
            {t("assets.cart.return")}
          </button>
        ) : null}
      </div>

      {lockedItems.length || unavailableItems.length ? (
        <div className="asset-operation-cart-warning">
          {lockedItems.length ? t("assets.cart.lockedSummary", { count: lockedItems.length }) : null}
          {lockedItems.length && unavailableItems.length ? " " : ""}
          {unavailableItems.length ? summarizeUnavailableAssets(unavailableItems, t) : null}
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
                  {asset.code} · {translateAssetAvailabilityLabel(availability, t)} · {translateAssetAvailabilityReason(availability, t)}
                </span>
              </div>
              <label className="asset-operation-cart-quantity">
                <span className="action-field-label">{t("assets.cart.qty")}</span>
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
                aria-label={t("assets.cart.removeAria", { name: asset.name })}
                className="icon-ghost-control"
                data-tooltip={t("assets.cart.removeTooltip")}
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
  const { t } = useTranslation();
  const location = useLocation();
  const { activeWorkspaceId } = useWorkspace();
  const { projects, refreshProjects } = useShellContext();
  const { addItems } = useCompareTray();
  const isProjectMode = Boolean(projectId);
  const translatedSortOptions = useMemo(
    () => assetSortOptions.map((option) => ({ ...option, label: t(option.label) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );
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
  const routeState = (location.state ?? null) as AssetsRouteState | null;
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [cartItemsById, setCartItemsById] = useState<Record<string, AssetOperationCartItem>>({});
  const [actionPanelOpen, setActionPanelOpen] = useState(false);
  const [packingPanelOpen, setPackingPanelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [packingError, setPackingError] = useState<string | null>(null);
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
  const assetEmptyTips = (key: string) => t(key, { returnObjects: true }) as string[];

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
    if (isProjectMode || !routeState?.assignProjectId) {
      return;
    }

    setAssignNextStep({
      projectId: routeState.assignProjectId,
      projectName: routeState.assignProjectName ?? t("assets.projectActions.selectedProjectFallback"),
    });
  }, [isProjectMode, routeState?.assignProjectId, routeState?.assignProjectName, t]);

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
      toast.success(t("assets.toasts.doneTitle"), result.summary);
      if (result.warningSummary) {
        toast.warning(t("assets.toasts.reviewAssignTitle"), result.warningSummary);
      }
      setActionPanelOpen(false);
      if (formValue.mode === "assign" && formValue.projectId) {
        const assignedProject = projects.find((project) => project.id === formValue.projectId);
        setAssignNextStep({
          projectId: formValue.projectId,
          projectName: assignedProject?.name ?? t("assets.selection.thisProject"),
        });
      } else {
        clearOperationCart();
      }
    } catch (nextError) {
      setActionError(getUserFacingErrorMessage(nextError, t("assets.toasts.unableAssignMove")));
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
      toast.success(t("assets.toasts.doneTitle"), result.summary);
      setAssignNextStep(null);
      setPackingPanelOpen(false);
      clearOperationCart();
      navigate("/packing-slips");
    } catch (nextError) {
      setPackingError(getUserFacingErrorMessage(nextError, t("assets.toasts.unableIssueSlip")));
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
        toast.success(t("assets.toasts.doneTitle"), result.summary);
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
        toast.success(t("assets.toasts.doneTitle"), result.summary);
      }

      setEditorError(null);
      setEditorMode(null);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("assets.toasts.unableSaveAsset")));
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
      toast.success(t("assets.toasts.doneTitle"), result.summary);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("assets.toasts.unableArchive")));
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

      const csvText = await file.text();
      setCsvImportPreview(buildAssetCsvPreview({ assets, catalog, csvText, fileName: file.name }));
      setCsvShowAllRows(false);
    } catch (error) {
      setCsvImportPreview(null);
      setEditorError(getUserFacingErrorMessage(error, t("assets.csv.importFailed")));
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
            t("assets.csv.rowImportFailed", {
              row: importRowNumber,
              message: getErrorMessage(error) || t("assets.csv.unknownImportError"),
            }),
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
        t("assets.csv.importedTitle"),
        [
          t("assets.csv.importedSummary", {
            count: importedCount,
            fileName: csvImportPreview.fileName,
          }),
          csvImportPreview.summary.duplicateRows
            ? t("assets.csv.mergedRows", { count: csvImportPreview.summary.duplicateRows })
            : "",
          skippedDuplicateCount ? t("assets.csv.skippedExisting", { count: skippedDuplicateCount }) : "",
          skippedReviewCount ? t("assets.csv.leftForReview", { count: skippedReviewCount }) : "",
        ].filter(Boolean).join(" "),
      );
    } catch (error) {
      setEditorError(getUserFacingErrorMessage(error, t("assets.csv.importFailed")));
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
        label: t("assets.columns.asset"),
        width: 280,
        minWidth: 220,
        render: (row: (typeof assets)[number]) => (
          <div className="identity-cell">
            <span className="identity-title">{row.name}</span>
            <span className="identity-meta">{row.code}</span>
            {row.linkedKitCount ? (
              <span className="identity-meta asset-kit-membership-inline">
                {t("assets.inKit", { codes: row.linkedKitCodes.join(", ") })}
              </span>
            ) : null}
          </div>
        ),
      },
      { key: "category", label: t("assets.columns.category"), width: 160, minWidth: 132, render: (row: (typeof assets)[number]) => row.category },
      {
        key: "quantity",
        label: t("assets.columns.stock"),
        width: 188,
        minWidth: 164,
        render: (row: (typeof assets)[number]) => (
          <span className="stock-inline-text">
            {formatAssetStockInline({
              availableQuantity: row.quantity,
              assignedQuantity: row.assignedQuantity,
              checkedOutQuantity: row.checkedOutQuantity,
            }, t)}
          </span>
        ),
      },
      { key: "tracking", label: t("assets.columns.tracking"), width: 110, minWidth: 96, render: (row: (typeof assets)[number]) => row.tracking },
      {
        key: "status",
        label: t("assets.columns.status"),
        width: 138,
        minWidth: 112,
        render: (row: (typeof assets)[number]) => {
          const presented = presentAssetStatus(row.status, t);
          return <StatusBadge tone={presented.tone}>{presented.label}</StatusBadge>;
        },
      },
      {
        key: "condition",
        label: t("assets.columns.condition"),
        width: 120,
        minWidth: 100,
        render: (row: (typeof assets)[number]) => {
          const presented = presentAssetCondition(row.condition, t);
          return <StatusBadge tone={presented.tone}>{presented.label}</StatusBadge>;
        },
      },
      { key: "custody", label: t("assets.columns.custody"), width: 112, minWidth: 96, render: (row: (typeof assets)[number]) => cleanDisplay(row.custody) },
      { key: "location", label: t("assets.columns.location"), width: 190, minWidth: 150, render: (row: (typeof assets)[number]) => row.location },
      { key: "project", label: t("assets.columns.project"), width: 170, minWidth: 140, render: (row: (typeof assets)[number]) => row.project },
      { key: "projectUnit", label: t("assets.columns.unit"), width: 150, minWidth: 124, render: (row: (typeof assets)[number]) => row.projectUnit },
      { key: "responsible", label: t("assets.columns.responsible"), width: 160, minWidth: 132, render: (row: (typeof assets)[number]) => row.responsible },
      { key: "serialNumber", label: t("assets.columns.serial"), width: 150, minWidth: 120, render: (row: (typeof assets)[number]) => row.serialNumber },
      { key: "qrCode", label: t("assets.columns.qr"), width: 130, minWidth: 108, render: (row: (typeof assets)[number]) => row.qrCode },
      { key: "purchasePrice", label: t("assets.columns.purchasePrice"), align: "right" as const, width: 132, minWidth: 112, render: (row: (typeof assets)[number]) => row.purchasePrice },
      { key: "additionalCosts", label: t("assets.columns.additionalCosts"), align: "right" as const, width: 140, minWidth: 120, render: (row: (typeof assets)[number]) => row.additionalCosts },
      { key: "currentBookValue", label: t("assets.columns.currentValue"), align: "right" as const, width: 132, minWidth: 112, render: (row: (typeof assets)[number]) => row.currentBookValue },
      { key: "replacementValue", label: t("assets.columns.replacementValue"), align: "right" as const, width: 148, minWidth: 124, render: (row: (typeof assets)[number]) => row.replacementValue },
      { key: "warehouseSlot", label: t("assets.columns.warehouse"), width: 126, minWidth: 108, render: (row: (typeof assets)[number]) => row.warehouseSlot },
      { key: "folderPath", label: t("assets.columns.folderPath"), width: 250, minWidth: 200, render: (row: (typeof assets)[number]) => row.folderPath },
      { key: "hasAccessories", label: t("assets.columns.accessories"), width: 110, minWidth: 96, render: (row: (typeof assets)[number]) => cleanDisplay(row.hasAccessories) },
      { key: "source", label: t("assets.columns.source"), width: 176, minWidth: 150, render: (row: (typeof assets)[number]) => row.source },
      { key: "incidents", label: t("assets.columns.openIssues"), align: "right" as const, width: 96, minWidth: 84, render: (row: (typeof assets)[number]) => row.incidentsOpen },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, t],
  );

  return (
    <div className="page-stack assets-page-stack">
      <SectionHeader
        title={isProjectMode ? t("assets.titleProject") : t("assets.title")}
      />

      {error ? <div className="empty-state">{t("assets.unavailable", { message: error })}</div> : null}
      {!error && isLoading ? (
        <SurfaceCard title={isProjectMode ? t("assets.titleProject") : t("assets.cardTitle")}>
          <TableSkeleton
            body={isProjectMode ? t("assets.loadingProject") : t("assets.loadingGlobal")}
            columns={6}
          />
        </SurfaceCard>
      ) : null}

      {catalogError ? <div className="action-feedback action-feedback-error">{t("assets.catalogUnavailable", { message: catalogError })}</div> : null}
      {assignNextStep && selectedRowIds.length ? (
        <div className="selection-action-bar asset-next-step-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">{t("assets.selection.readyTitle")}</span>
            <span className="selection-action-subtitle">
              {t("assets.selection.readyBody", { project: assignNextStep.projectName })}
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
              <span>{t("assets.selection.createSlip")}</span>
            </button>
            <button
              className="ghost-control action-row-button"
              onClick={() => navigate(`/projects/${assignNextStep.projectId}/assets`)}
              type="button"
            >
              {t("assets.selection.openProjectAssets")}
            </button>
          </div>
        </div>
      ) : null}
      {editorError && !editorMode ? <div className="action-feedback action-feedback-error">{editorError}</div> : null}
      {selectedKitLockSummary ? (
        <div className="action-feedback action-feedback-warning">
          {t("assets.selection.kitLocked", { summary: selectedKitLockSummary })}
        </div>
      ) : null}

      {!error && !isLoading && assets.length === 0 ? (
        <GuidedEmptyState
          title={isProjectMode ? t("assets.empty.projectTitle") : t("assets.empty.globalTitle")}
          body={isProjectMode ? t("assets.empty.projectBody") : t("assets.empty.globalBody")}
          tips={isProjectMode ? assetEmptyTips("assets.empty.tipsProject") : assetEmptyTips("assets.empty.tipsGlobal")}
          actionLabel={isProjectMode ? t("assets.empty.projectAction") : t("assets.empty.globalAction")}
          onAction={() => {
            if (isProjectMode) {
              navigate("/assets");
              return;
            }

            setEditorMode("create");
            setEditorError(null);
          }}
          secondaryActionLabel={t("assets.empty.openCatalog")}
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
        <ModalShell
          onClose={() => {
            setEditorMode(null);
            setEditorError(null);
          }}
        >
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
        </ModalShell>
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
          title={t("assets.cardTitle")}
          aside={
            <div className="asset-registry-header-actions">
              {isProjectMode ? (
                <>
                  <button
                    className="asset-create-button action-row-button"
                    onClick={() =>
                      navigate("/assets", {
                        state: {
                          assignProjectId: projectId ?? undefined,
                          assignProjectName: projectName ?? undefined,
                        } satisfies AssetsRouteState,
                      })
                    }
                    type="button"
                  >
                    <Plus size={14} />
                    <span>{t("assets.projectActions.assignAssets")}</span>
                  </button>
                  <button
                    className="ghost-control action-row-button"
                    disabled={!selectedRowIds.length}
                    onClick={() => {
                      setActionPanelOpen(true);
                      setAssignNextStep(null);
                    }}
                    title={!selectedRowIds.length ? t("assets.projectActions.selectToEdit") : undefined}
                    type="button"
                  >
                    <SquarePen size={14} />
                    <span>{t("assets.projectActions.editAssignments")}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="asset-create-button action-row-button"
                    onClick={() => {
                      setEditorMode("create");
                      setEditorError(null);
                    }}
                    type="button"
                  >
                    <Plus size={14} />
                    <span>{t("assets.newAsset")}</span>
                  </button>
                  <button
                    className="ghost-control action-row-button"
                    disabled={isImportingAssets}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <Import size={14} />
                    <span>{isImportingAssets ? t("assets.importing") : t("assets.importCsv")}</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    accept=".csv,text/csv"
                    hidden
                    onChange={(event) => void handleImportCsvFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </>
              )}
            </div>
          }
        >
          <ListToolbar
            activeSortLabel={
              assetControls.activeSortOption ? t(assetControls.activeSortOption.label) : undefined
            }
            onSearchValueChange={assetControls.setSearchValue}
            onSortByChange={assetControls.setSortField}
            onToggleSortDirection={assetControls.toggleSortDirection}
            resultCount={assets.length}
            resultLabel={t("assets.resultLabel")}
            searchPlaceholder={
              isProjectMode
                ? t("assets.toolbar.searchPlaceholderProject")
                : t("assets.toolbar.searchPlaceholder")
            }
            searchValue={assetControls.searchValue}
            sortBy={assetControls.sortBy}
            sortDirection={assetControls.sortDirection}
            sortOptions={translatedSortOptions}
          />
          {csvImportPreview ? (
            <div className={`asset-import-preview${csvImportPreview.errors.length ? " has-errors" : ""}`}>
              <div className="asset-import-preview-header">
                <div className="asset-import-preview-copy">
                  <span className="asset-import-preview-kicker">{t("assets.csv.preview")}</span>
                  <strong>{csvImportPreview.fileName}</strong>
                  <span>
                    {csvImportPreview.summary.stockSource === "declaredQuantity"
                      ? t("assets.csv.stockUsesDeclared")
                      : t("assets.csv.stockUsesRows")}
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
                      <span>{csvReportCopied ? t("common.copied") : t("assets.csv.copyReport")}</span>
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
                    {t("common.cancel")}
                  </button>
                  {csvDerivedSummary?.validationIssues.length && csvDerivedSummary.readyDrafts.length ? (
                    <button
                      className="ghost-control action-row-button"
                      disabled={isImportingAssets}
                      onClick={() => void handleConfirmCsvImport("ready")}
                      type="button"
                    >
                      {t("assets.csv.importReadyRows")}
                    </button>
                  ) : null}
                  <button
                    className="asset-create-button action-row-button"
                    disabled={isImportingAssets || !csvDerivedSummary?.canImport}
                    onClick={() => void handleConfirmCsvImport("all")}
                    type="button"
                  >
                    {isImportingAssets ? t("assets.importing") : t("assets.csv.importAssets")}
                  </button>
                </div>
              </div>

              <div className="asset-import-preview-stats">
                {[
                  [t("assets.csv.stats.rows"), csvImportPreview.summary.totalRows],
                  [t("assets.csv.stats.uniqueAssets"), csvImportPreview.summary.uniqueCodes],
                  [t("assets.csv.stats.toImport"), csvDerivedSummary?.importableCount ?? csvImportPreview.summary.importableCount],
                  [t("assets.csv.stats.ready"), csvDerivedSummary?.readyDrafts.length ?? 0],
                  [t("assets.csv.stats.needsReview"), csvDerivedSummary?.needsReviewDrafts.length ?? 0],
                  [t("assets.csv.stats.totalUnits"), csvDerivedSummary?.importableStock ?? csvImportPreview.summary.importableStock],
                  [t("assets.csv.stats.existing"), csvDerivedSummary?.existingCount ?? csvImportPreview.summary.existingCodes],
                  [t("assets.csv.stats.mergedRows"), csvImportPreview.summary.duplicateRows],
                ].map(([label, value]) => (
                  <span key={label}>
                    <strong>{value}</strong>
                    {label}
                  </span>
                ))}
                <span className={csvImportPreview.summary.warnings.length ? "asset-import-stat-warning" : undefined}>
                  <strong>{csvImportPreview.summary.warnings.length}</strong>
                  {t("assets.csv.stats.warnings")}
                </span>
                <span className={csvImportPreview.errors.length ? "asset-import-stat-error" : undefined}>
                  <strong>{csvImportPreview.errors.length}</strong>
                  {t("assets.csv.stats.errors")}
                </span>
              </div>

              {csvReviewDrafts.length ? (
                <div className="asset-import-review">
                  <div className="asset-import-review-header">
                    <div>
                      <strong>{t("assets.csv.reviewTitle")}</strong>
                      <span>{t("assets.csv.reviewBody")}</span>
                    </div>
                    <div className="asset-import-review-header-actions">
                      {csvHiddenReviewCount ? <span>{t("assets.csv.moreRowsHidden", { count: csvHiddenReviewCount })}</span> : null}
                      {(csvDerivedSummary?.importableDrafts.length ?? 0) > 8 ? (
                        <button
                          className="ghost-control action-row-button"
                          onClick={() => setCsvShowAllRows((current) => !current)}
                          type="button"
                        >
                          {csvShowAllRows ? t("assets.csv.showLess") : t("assets.csv.showAll")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="asset-import-review-table">
                    <div className="asset-import-review-row is-header">
                      <span>{t("assets.csv.reviewColumns.row")}</span>
                      <span>{t("assets.csv.reviewColumns.status")}</span>
                      <span>{t("assets.csv.reviewColumns.asset")}</span>
                      <span>{t("assets.csv.reviewColumns.code")}</span>
                      <span>{t("assets.csv.reviewColumns.category")}</span>
                      <span>{t("assets.csv.reviewColumns.location")}</span>
                      <span>{t("assets.csv.reviewColumns.qty")}</span>
                      <span>{t("assets.csv.reviewColumns.serial")}</span>
                      <span>{t("assets.csv.reviewColumns.purchase")}</span>
                      <span>{t("assets.csv.reviewColumns.additionalCosts")}</span>
                      <span>{t("assets.csv.reviewColumns.current")}</span>
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
                              ? t("assets.csv.status.needsReview")
                              : draft.importWarnings?.length
                                ? t("assets.csv.status.review")
                                : t("assets.csv.status.ready")}
                          </span>
                          <input
                            aria-label={t("assets.csv.aria.assetName", { row: draft.importRowNumber })}
                            className="asset-import-review-input"
                            onChange={handleCsvTextEdit(draft.importRowNumber, "name")}
                            value={draft.name}
                          />
                          <input
                            aria-label={t("assets.csv.aria.assetCode", { row: draft.importRowNumber })}
                            className="asset-import-review-input asset-import-review-code"
                            onChange={handleCsvTextEdit(draft.importRowNumber, "internalCode")}
                            value={draft.internalCode}
                          />
                          <select
                            aria-label={t("assets.csv.aria.category", { row: draft.importRowNumber })}
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
                            aria-label={t("assets.csv.aria.location", { row: draft.importRowNumber })}
                            className="asset-import-review-input"
                            onChange={handleCsvSelectEdit(draft.importRowNumber, "defaultLocationId")}
                            value={draft.defaultLocationId ?? ""}
                          >
                            <option value="">{t("assets.csv.noLocation")}</option>
                            {catalog.locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.code} · {location.name}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={t("assets.csv.aria.quantity", { row: draft.importRowNumber })}
                            className="asset-import-review-input asset-import-review-quantity"
                            min={0}
                            onChange={handleCsvQuantityEdit(draft.importRowNumber)}
                            type="number"
                            value={draft.totalQuantity}
                          />
                          <input
                            aria-label={t("assets.csv.aria.serial", { row: draft.importRowNumber })}
                            className="asset-import-review-input"
                            onChange={handleCsvTextEdit(draft.importRowNumber, "serialNumber")}
                            value={draft.serialNumber}
                          />
                          <input
                            aria-label={t("assets.csv.aria.purchasePrice", { row: draft.importRowNumber })}
                            className="asset-import-review-input asset-import-review-quantity"
                            min={0}
                            onChange={handleCsvOptionalMoneyEdit(draft.importRowNumber, "purchasePrice")}
                            type="number"
                            value={draft.purchasePrice ?? ""}
                          />
                          <input
                            aria-label={t("assets.csv.aria.additionalCosts", { row: draft.importRowNumber })}
                            className="asset-import-review-input asset-import-review-quantity"
                            min={0}
                            onChange={handleCsvOptionalMoneyEdit(draft.importRowNumber, "additionalCosts")}
                            type="number"
                            value={draft.additionalCosts ?? ""}
                          />
                          <input
                            aria-label={t("assets.csv.aria.currentValue", { row: draft.importRowNumber })}
                            className="asset-import-review-input asset-import-review-quantity"
                            min={0}
                            onChange={handleCsvOptionalMoneyEdit(draft.importRowNumber, "currentBookValue")}
                            type="number"
                            value={draft.currentBookValue ?? ""}
                          />
                        </div>
                        <textarea
                          aria-label={t("assets.csv.aria.notes", { row: draft.importRowNumber })}
                          className="asset-import-review-notes"
                          onChange={handleCsvNotesEdit(draft.importRowNumber)}
                          placeholder={t("assets.csv.notes")}
                          rows={2}
                          value={draft.notes}
                        />
                        {draft.importWarnings?.length ? (
                          <div className="asset-import-review-row-note">
                            {t("assets.csv.rowNote", { row: draft.importRowNumber, message: draft.importWarnings.join(" ") })}
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
                      <strong>{t("assets.csv.nothingNewTitle")}</strong>
                      <span>{t("assets.csv.nothingNewBody")}</span>
                      <span>{t("assets.csv.nothingNewFootnote")}</span>
                    </div>
                  ) : null}

                  {csvImportPreview.existingMatches.length ? (
                    <div className="asset-import-preview-issue-card neutral">
                      <strong>{t("assets.csv.existingMatches", { count: csvImportPreview.existingMatches.length })}</strong>
                      {csvImportPreview.existingMatches.slice(0, 5).map((match) => (
                        <span key={match.code}>
                          {t("assets.csv.existingMatchLine", {
                            code: match.code,
                            name: match.existingName,
                            count: match.existingStock,
                          })}
                        </span>
                      ))}
                      {csvImportPreview.existingMatches.length > 5 ? (
                        <span className="asset-import-more-matches">
                          {t("assets.csv.moreMatches", { count: csvImportPreview.existingMatches.length - 5 })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {csvImportPreview.summary.warnings.length ? (
                    <div className="asset-import-preview-issue-card warning">
                      <strong>{t("assets.csv.reviewBeforeImporting")}</strong>
                      {csvImportPreview.summary.warnings.slice(0, 4).map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                      {csvImportPreview.summary.warnings.length > 4 ? (
                        <span>{t("assets.csv.moreWarnings", { count: csvImportPreview.summary.warnings.length - 4 })}</span>
                      ) : null}
                    </div>
                  ) : null}

                  {csvImportPreview.errors.length ? (
                    <div className="asset-import-preview-issue-card error">
                      <strong>{t("assets.csv.fixRowsTitle")}</strong>
                      {csvImportPreview.errors.slice(0, 6).map((error) => (
                        <span key={`${error.rowNumber}-${error.message}`}>
                          {t("assets.csv.rowNote", { row: error.rowNumber, message: error.message })}
                        </span>
                      ))}
                      {csvImportPreview.errors.length > 6 ? (
                        <span>{t("assets.csv.moreRowErrors", { count: csvImportPreview.errors.length - 6 })}</span>
                      ) : null}
                    </div>
                  ) : null}

                  {csvDerivedSummary?.validationIssues.length ? (
                    <div className="asset-import-preview-issue-card error">
                      <strong>{t("assets.csv.reviewEditsTitle")}</strong>
                      {csvDerivedSummary.validationIssues.slice(0, 6).map((issue) => (
                        <span key={`${issue.rowNumber}-${issue.message}`}>
                          {t("assets.csv.rowNote", { row: issue.rowNumber, message: issue.message })}
                        </span>
                      ))}
                      {csvDerivedSummary.validationIssues.length > 6 ? (
                        <span>{t("assets.csv.moreRowIssues", { count: csvDerivedSummary.validationIssues.length - 6 })}</span>
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
            rowActions={(row) => [
              {
                key: "open",
                label: t("assets.quickPreview.openDetail"),
                onSelect: (target) => navigate(`/assets/${target.id}`),
              },
              {
                key: "edit",
                label: t("assets.quickPreview.editAsset"),
                icon: <SquarePen size={14} />,
                onSelect: (target) => {
                  setSelectedAssetId(target.id);
                  setEditorMode("edit");
                  setEditorError(null);
                },
              },
            ]}
            defaultVisibleColumnKeys={assetDefaultColumnKeys}
            emptyContent={
              <GuidedEmptyState
                title={
                  assetControls.searchValue
                    ? t("assets.empty.tableNoMatches")
                    : isProjectMode
                      ? t("assets.empty.tableNoneProjectTitle")
                      : t("assets.empty.tableNoneTitle")
                }
                body={
                  assetControls.searchValue
                    ? t("assets.empty.tableNoMatchesBody")
                    : isProjectMode
                      ? t("assets.empty.tableNoneBodyProject")
                      : t("assets.empty.tableNoneBody")
                }
                tone="subtle"
                actionLabel={assetControls.searchValue ? t("assets.empty.clearSearch") : undefined}
                onAction={assetControls.searchValue ? () => assetControls.setSearchValue("") : undefined}
                tips={
                  assetControls.searchValue
                    ? undefined
                    : isProjectMode
                      ? assetEmptyTips("assets.empty.tipsTableProject")
                      : assetEmptyTips("assets.empty.tipsTable")
                }
              />
            }
            getRowId={(row) => row.id}
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
                    meta: asset.projectUnit && asset.projectUnit !== "—" ? t("assets.cart.unitMeta", { unit: asset.projectUnit }) : undefined,
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
                    aria-label={t("assets.quickPreview.closeAria")}
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
                      <span className="summary-label">{t("assets.quickPreview.assetCode")}</span>
                      <span className="summary-value">{activeAsset.code}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.quickPreview.location")}</span>
                      <span className="summary-value">{activeAsset.location}</span>
                    </div>
                    {formatAssetStockDetailRows({
                      totalQuantity: activeAsset.totalQuantity,
                      availableQuantity: activeAsset.quantity,
                      assignedQuantity: activeAsset.assignedQuantity,
                      checkedOutQuantity: activeAsset.checkedOutQuantity,
                    }, t).map((row) => (
                      <div key={row.label} className="summary-row">
                        <span className="summary-label">{row.label}</span>
                        <span className="summary-value">{row.value}</span>
                      </div>
                    ))}
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.quickPreview.projectResponsible")}</span>
                      <span className="summary-value">
                        {activeAsset.project} · {activeAsset.responsible}
                      </span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.quickPreview.serial")}</span>
                      <span className="summary-value">
                        {activeAsset.serialNumber}
                      </span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.quickPreview.conditionCustody")}</span>
                      <span className="summary-value">
                        {activeAsset.condition} · {activeAsset.custody}
                      </span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.quickPreview.kitMembership")}</span>
                      <span className="summary-value">
                        {activeAsset.linkedKitCount ? activeAsset.linkedKitCodes.join(" · ") : t("assets.quickPreview.standalone")}
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
                                setActionError(getUserFacingErrorMessage(nextError, t("assets.toasts.unableOpenImage")));
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
                            <span>{t("assets.quickPreview.previewUnavailable")}</span>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="asset-preview-image-empty">{t("assets.quickPreview.noImages")}</div>
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
                            toast.success(t("assets.toasts.doneTitle"), result.summary);
                          } catch (nextError) {
                            setActionError(getUserFacingErrorMessage(nextError, t("assets.toasts.unableAddImages")));
                          } finally {
                            setIsUploadingPreviewImages(false);
                          }
                        })();
                      }}
                      type="button"
                    >
                      <FileUp size={14} />
                      <span>
                        {isUploadingPreviewImages
                          ? t("assets.quickPreview.adding")
                          : activeAssetImageSlots <= 0
                            ? t("assets.quickPreview.twoImagesMax")
                            : t("assets.quickPreview.addImages")}
                      </span>
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
                      <span>{t("assets.quickPreview.editAsset")}</span>
                    </button>
                    <button className="action-primary-button" onClick={() => navigate(`/assets/${activeAsset.id}`)} type="button">
                      {t("assets.quickPreview.openDetail")}
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
  const { t } = useTranslation();
  const { activeWorkspaceId } = useWorkspace();
  const { data: assetsOverview, error } = useAssetsOverview({ workspaceId: activeWorkspaceId });
  // Operational cards only earn space when they need attention — hide the zeros
  // so a clean inventory shows a short, meaningful strip instead of a wall of 0s.
  const operationalCards = [
    { ...assetsOverview.cards.overdueReturns, label: t("assets.metrics.overdueReturns") },
    { ...assetsOverview.cards.openPackingSlips, label: t("assets.metrics.openPackingSlips") },
    { ...assetsOverview.cards.activeIncidents, label: t("assets.metrics.activeIncidents") },
    { ...assetsOverview.cards.maintenanceWatch, label: t("assets.metrics.maintenanceWatch") },
  ].filter((card) => String(card.value).trim() !== "0" && String(card.value).trim() !== "");
  const overviewCards = [
    {
      label: t("assets.metrics.totalUnits"),
      value: assetsOverview.totalAssets,
      tone: "info" as const,
    },
    {
      label: t("assets.metrics.reservedOut"),
      value: assetsOverview.assignedAssets,
      tone: "info" as const,
    },
    ...operationalCards,
  ];

  return (
    <>
      {error ? <div className="action-feedback action-feedback-error">{t("assets.metricsUnavailable", { message: error })}</div> : null}
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
