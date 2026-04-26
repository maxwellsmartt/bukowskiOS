import { useMemo, useRef, useState } from "react";
import { FileUp, Plus, SquarePen, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { AssetListQuery, AssetSortField } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { PackingSlipBuilderPanel, type PackingSlipBuilderDraft } from "@features/packing/PackingSlipBuilderPanel";
import { createPackingSlip } from "@features/packing/usePackingData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useShellContext } from "@shared/hooks/useShellContext";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { formatAssetStockDetailRows, formatAssetStockInline } from "@shared/lib/assetQuantityPresentation";
import { uiPreferenceKeys, writePreference } from "@shared/lib/preferences";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

import { AssetAssignMovePanel, type AssetAssignMoveFormValue } from "./AssetAssignMovePanel";
import { AssetEditorPanel, type AssetEditorDraft } from "./AssetEditorPanel";
import { archiveAsset, assignMoveAssets, createAsset, updateAsset, useAssetDetail, useAssetsList, useAssetsOverview } from "./useAssetsData";

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

const parseCsvQuantity = (value: string, rowNumber: number) => {
  if (!value) {
    return 1;
  }

  const parsed = Number.parseInt(value.replace(/[,\s]/g, ""), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`CSV row ${rowNumber} has an invalid quantity.`);
  }

  return parsed;
};

const joinCsvNotes = (parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join("\n");
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
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
  replacementValue: number | undefined;
  ownershipType: string;
  qrCodeValue: string;
  totalQuantity: number;
};

type AssetCsvCatalogOption = {
  id: string;
  code: string;
  name: string;
};

type AssetCsvPreview = {
  fileName: string;
  drafts: AssetCsvDraft[];
  summary: {
    totalRows: number;
    uniqueCodes: number;
    duplicateRows: number;
    existingCodes: number;
    importableCount: number;
    importableStock: number;
    warnings: string[];
  };
};

const aggregateAssetCsvDrafts = (drafts: AssetCsvDraft[]) => {
  const draftsByCode = new Map<string, AssetCsvDraft & { importRowNumbers: number[]; serialNumbers: string[] }>();
  let mergedDuplicateRows = 0;

  for (const draft of drafts) {
    const normalizedCode = draft.internalCode.trim().toUpperCase();
    const existingDraft = draftsByCode.get(normalizedCode);

    if (!existingDraft) {
      draftsByCode.set(normalizedCode, {
        ...draft,
        importRowNumbers: [draft.importRowNumber],
        serialNumbers: draft.serialNumber ? [draft.serialNumber] : [],
      });
      continue;
    }

    mergedDuplicateRows += 1;
    existingDraft.importRowNumbers.push(draft.importRowNumber);
    existingDraft.totalQuantity = Math.max(existingDraft.totalQuantity, draft.totalQuantity, existingDraft.importRowNumbers.length);

    if (draft.serialNumber && !existingDraft.serialNumbers.includes(draft.serialNumber)) {
      existingDraft.serialNumbers.push(draft.serialNumber);
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
    })),
    mergedDuplicateRows,
  };
};

const buildAssetCsvPreview = ({
  assets,
  catalog,
  csvText,
  fileName,
}: {
  assets: Array<{ code: string }>;
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
  let unmatchedWarehouseSlots = 0;
  const existingCodes = new Set(assets.map((asset) => asset.code.trim().toUpperCase()).filter(Boolean));
  const rawDrafts = dataRows.map((values, index): AssetCsvDraft => {
    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const rowNumber = index + 2;
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
    const categoryValue = resolveCsvValue(row, ["categoryId", "categoryCode", "category"]);
    const explicitLocationValue = resolveCsvValue(row, ["defaultLocationId", "locationCode", "location", "defaultLocation"]);
    const warehouseSlot = resolveCsvValue(row, ["Ubicado en almacén", "warehouseSlot", "warehouse"]);
    const categoryId = categoryValue ? categoryByCodeOrName.get(normalizeCsvLookup(categoryValue)) : undefined;
    const defaultLocationId = explicitLocationValue
      ? locationByCodeOrName.get(normalizeCsvLookup(explicitLocationValue))
      : warehouseSlot
        ? locationByCodeOrName.get(normalizeCsvLookup(warehouseSlot))
        : undefined;
    const replacementValueText = resolveCsvValue(row, ["replacementValue", "replacement", "value"]);
    const replacementValue = replacementValueText ? Number(replacementValueText.replace(/[$,\s]/g, "")) : undefined;
    const conditionStatus = resolveCsvValue(row, ["condition", "conditionStatus"]) || "Good";
    const totalQuantity = parseCsvQuantity(resolveCsvValue(row, ["quantity", "Cantidad actual", "currentQuantity"]), rowNumber);
    const folderPath = resolveCsvValue(row, ["Estructura de la carpeta (Carpeta)", "folderPath"]);
    const folderType = resolveCsvValue(row, ["Tipo de articulo (Carpeta)", "folderType"]);
    const positionType = resolveCsvValue(row, ["Tipo (posición/case/set)", "positionType"]);
    const externalNote = resolveCsvValue(row, ["Nota externa", "externalNote", "notes"]);
    const serialNumber = resolveCsvValue(row, ["serialNumber", "serial", "Número de Serie (Número de serie)"]);

    if (!name || !internalCode) {
      throw new Error(`CSV row ${rowNumber} is missing name or code.`);
    }

    if (categoryValue && !categoryId) {
      warnings.add(`Unknown category "${categoryValue}" will use ${defaultCategory.name}.`);
    }

    if (explicitLocationValue && !defaultLocationId) {
      warnings.add(`Unknown location "${explicitLocationValue}" will be left blank.`);
    }

    if (!explicitLocationValue && warehouseSlot && !defaultLocationId) {
      unmatchedWarehouseSlots += 1;
    }

    if (replacementValueText && Number.isNaN(replacementValue)) {
      throw new Error(`CSV row ${rowNumber} has an invalid replacement value.`);
    }

    if (!allowedCsvConditions.has(conditionStatus)) {
      throw new Error(`CSV row ${rowNumber} has an unsupported condition. Use Good, Review, or Damaged.`);
    }

    return {
      importRowNumber: rowNumber,
      name,
      internalCode: internalCode.toUpperCase(),
      categoryId: categoryId ?? defaultCategory.id,
      defaultLocationId,
      brand: resolveCsvValue(row, ["brand"]),
      model: resolveCsvValue(row, ["model"]),
      serialNumber,
      description: resolveCsvValue(row, ["description"]),
      conditionStatus,
      notes: joinCsvNotes([
        externalNote,
        warehouseSlot && `Warehouse slot: ${warehouseSlot}`,
        folderPath && `Source folder: ${folderPath}`,
        folderType && `Source folder type: ${folderType}`,
        positionType && `Source item type: ${positionType}`,
      ]),
      replacementValue,
      ownershipType: resolveCsvValue(row, ["ownership", "ownershipType"]) || "owned",
      qrCodeValue: resolveCsvValue(row, ["qr", "qrCode", "qrCodeValue", "barcode", "Códigos QR"]),
      totalQuantity,
    };
  });
  const { drafts, mergedDuplicateRows } = aggregateAssetCsvDrafts(rawDrafts);
  const importableDrafts = drafts.filter((draft) => !existingCodes.has(draft.internalCode.trim().toUpperCase()));

  if (unmatchedWarehouseSlots) {
    warnings.add(
      `${unmatchedWarehouseSlots} warehouse slot value${unmatchedWarehouseSlots === 1 ? "" : "s"} will be preserved in notes.`,
    );
  }

  return {
    fileName,
    drafts,
    summary: {
      totalRows: dataRows.length,
      uniqueCodes: drafts.length,
      duplicateRows: mergedDuplicateRows,
      existingCodes: drafts.length - importableDrafts.length,
      importableCount: importableDrafts.length,
      importableStock: importableDrafts.reduce((total, draft) => total + draft.totalQuantity, 0),
      warnings: Array.from(warnings),
    },
  };
};

export const AssetsPage = ({ projectId = null, projectName = null }: AssetsPageProps) => (
  <AssetsContent projectId={projectId} projectName={projectName} />
);

const AssetsContent = ({ projectId, projectName }: AssetsPageProps) => {
  const { activeWorkspaceId } = useWorkspace();
  const { activeProject, projects, refreshProjects } = useShellContext();
  const { addItems, hasItem } = useCompareTray();
  const isProjectMode = Boolean(projectId);
  const effectiveProjectName = projectName ?? (isProjectMode ? activeProject?.name ?? null : null);
  const sectionScopeLabel = useSectionScopeLabel();
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
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [actionPanelOpen, setActionPanelOpen] = useState(false);
  const [packingPanelOpen, setPackingPanelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [packingError, setPackingError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isSubmittingPacking, setIsSubmittingPacking] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSubmittingEditor, setIsSubmittingEditor] = useState(false);
  const [isArchivingAsset, setIsArchivingAsset] = useState(false);
  const [isImportingAssets, setIsImportingAssets] = useState(false);
  const [csvImportPreview, setCsvImportPreview] = useState<AssetCsvPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const editorAssetId = editorMode === "edit" ? selectedAssetId ?? undefined : undefined;
  const { data: editorDetail, reload: reloadEditorDetail } = useAssetDetail(editorAssetId);

  const activeAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );
  const selectedAssets = useMemo(() => {
    const assetMap = new Map(assets.map((asset) => [asset.id, asset] as const));
    return selectedRowIds
      .map((assetId) => assetMap.get(assetId))
      .filter((asset): asset is (typeof assets)[number] => Boolean(asset));
  }, [assets, selectedRowIds]);
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
      setActionFeedback(result.summary);
      setActionWarning(result.warningSummary ?? null);
      setActionPanelOpen(false);
      setSelectedRowIds([]);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "Unable to apply assign or move.");
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
      setActionFeedback(result.summary);
      setActionWarning(null);
      setPackingPanelOpen(false);
      setSelectedRowIds([]);
      navigate("/packing-slips");
    } catch (nextError) {
      setPackingError(nextError instanceof Error ? nextError.message : "Unable to issue packing slip.");
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
        setActionFeedback(result.summary);
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
        setActionFeedback(result.summary);
        setActionWarning(null);
      }

      setEditorError(null);
      setEditorMode(null);
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : "Unable to save asset changes.");
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
      setActionFeedback(result.summary);
      setActionWarning(null);
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : "Unable to archive asset.");
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
      setActionFeedback(null);
      setActionWarning(null);
      const csvText = await file.text();
      setCsvImportPreview(buildAssetCsvPreview({ assets, catalog, csvText, fileName: file.name }));
    } catch (error) {
      setCsvImportPreview(null);
      setEditorError(error instanceof Error ? error.message : "Asset CSV import failed.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleConfirmCsvImport = async () => {
    if (!csvImportPreview) {
      return;
    }

    try {
      setIsImportingAssets(true);
      setEditorError(null);
      setActionFeedback(null);
      setActionWarning(null);
      const existingCodes = new Set(assets.map((asset) => asset.code.trim().toUpperCase()).filter(Boolean));
      let importedCount = 0;
      let skippedDuplicateCount = 0;

      for (const draft of csvImportPreview.drafts) {
        const { importRowNumber, ...assetDraft } = draft;
        const normalizedCode = assetDraft.internalCode.trim().toUpperCase();

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
      setCsvImportPreview(null);
      setActionFeedback(
        `Imported ${importedCount} asset${importedCount === 1 ? "" : "s"} from ${csvImportPreview.fileName}.${
          csvImportPreview.summary.duplicateRows
            ? ` Merged ${csvImportPreview.summary.duplicateRows} duplicate CSV row${
                csvImportPreview.summary.duplicateRows === 1 ? "" : "s"
              }.`
            : ""
        }${
          skippedDuplicateCount ? ` Skipped ${skippedDuplicateCount} existing code${skippedDuplicateCount === 1 ? "" : "s"}.` : ""
        }`,
      );
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Asset CSV import failed.");
    } finally {
      setIsImportingAssets(false);
    }
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
        title={isProjectMode ? "Project Assets" : "Assets"}
        contextLabel={isProjectMode ? sectionScopeLabel ?? undefined : undefined}
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

      <div className="chip-row">
        {isProjectMode ? <StatusBadge>{effectiveProjectName ?? "Project scope"}</StatusBadge> : null}
      </div>

      {catalogError ? <div className="action-feedback action-feedback-error">Catalog unavailable: {catalogError}</div> : null}
      {actionFeedback ? <div className="action-feedback action-feedback-success">{actionFeedback}</div> : null}
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
          isSubmitting={isSubmittingAction}
          locations={catalog.locations}
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
          defaultProjectId={isProjectMode ? projectId ?? null : null}
          departments={catalog.departments}
          error={packingError}
          isSubmitting={isSubmittingPacking}
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

      <div className={`list-layout asset-list-layout${activeAsset ? " has-preview" : ""}`}>
        <SurfaceCard
          className="asset-registry-card"
          title={isProjectMode ? "Assets" : "Assets"}
          aside={
            <div className="asset-registry-header-actions">
              {selectedRowIds.length ? (
                <>
                  <button
                    className="ghost-control action-row-button"
                    onClick={() =>
                      addItems(
                        assets
                          .filter((asset) => selectedRowIds.includes(asset.id))
                          .map((asset) => ({
                            id: asset.id,
                            entityType: "asset" as const,
                            label: `${asset.code} · ${asset.name}`,
                            subtitle: `${asset.location} · ${asset.project}`,
                            meta: asset.projectUnit && asset.projectUnit !== "—" ? `Unit · ${asset.projectUnit}` : undefined,
                          })),
                      )
                    }
                    type="button"
                  >
                    Add to compare
                  </button>
                  <button
                    className="ghost-control action-row-button"
                    disabled={selectedKitLockedAssets.length > 0}
                    onClick={() => {
                      setPackingPanelOpen(true);
                      setActionPanelOpen(false);
                      setPackingError(null);
                      setActionFeedback(null);
                    }}
                    type="button"
                  >
                    Create packing slip
                  </button>
                  <button
                    className="action-primary-button action-row-button"
                    disabled={selectedKitLockedAssets.length > 0}
                    onClick={() => {
                      setActionPanelOpen(true);
                      setPackingPanelOpen(false);
                      setActionFeedback(null);
                    }}
                    type="button"
                  >
                    Assign / move selected
                  </button>
                </>
              ) : null}
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
            <div className="asset-import-preview">
              <div className="asset-import-preview-copy">
                <span className="asset-import-preview-kicker">CSV preview</span>
                <strong>{csvImportPreview.fileName}</strong>
              </div>
              <div className="asset-import-preview-stats">
                <span>
                  <strong>{csvImportPreview.summary.totalRows}</strong>
                  rows
                </span>
                <span>
                  <strong>{csvImportPreview.summary.uniqueCodes}</strong>
                  unique codes
                </span>
                <span>
                  <strong>{csvImportPreview.summary.importableCount}</strong>
                  to import
                </span>
                <span>
                  <strong>{csvImportPreview.summary.importableStock}</strong>
                  stock
                </span>
                <span>
                  <strong>{csvImportPreview.summary.existingCodes}</strong>
                  existing
                </span>
                <span>
                  <strong>{csvImportPreview.summary.duplicateRows}</strong>
                  merged
                </span>
              </div>
              {csvImportPreview.summary.warnings.length ? (
                <div className="asset-import-preview-warnings">
                  {csvImportPreview.summary.warnings.slice(0, 3).map((warning) => (
                    <span key={warning}>{warning}</span>
                  ))}
                  {csvImportPreview.summary.warnings.length > 3 ? (
                    <span>{csvImportPreview.summary.warnings.length - 3} more warning(s).</span>
                  ) : null}
                </div>
              ) : null}
              <div className="asset-import-preview-actions">
                <button
                  className="ghost-control action-row-button"
                  disabled={isImportingAssets}
                  onClick={() => setCsvImportPreview(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="asset-create-button action-row-button"
                  disabled={isImportingAssets || csvImportPreview.summary.importableCount === 0}
                  onClick={() => void handleConfirmCsvImport()}
                  type="button"
                >
                  {isImportingAssets ? "Importing..." : "Import assets"}
                </button>
              </div>
            </div>
          ) : null}
          <DataTable
            activeRowId={selectedAssetId}
            autoScrollToActiveRow
            columns={assetColumns}
            defaultVisibleColumnKeys={assetDefaultColumnKeys}
            emptyMessage={
              isProjectMode
                ? "No assets are assigned to this project yet."
                : "No assets yet. Create the first one after setting up the catalog."
            }
            getRowId={(row) => row.id}
            maxHeight={isProjectMode ? "min(68vh, 760px)" : "min(56vh, 680px)"}
            onRowClick={(row) => setSelectedAssetId(row.id)}
            onRowDoubleClick={(row) => navigate(`/assets/${row.id}`)}
            onSortRequest={assetControls.handleColumnSortRequest}
            persistKey={isProjectMode ? "project-assets-registry-v2" : "assets-registry-v2"}
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
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

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

              <div className="action-panel-actions action-panel-actions-start">
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
