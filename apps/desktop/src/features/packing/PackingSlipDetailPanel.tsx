import { Download, FileText, RotateCcw, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PackingSlipDetailSnapshot } from "@contracts";
import { DataTable } from "@shared/components/DataTable";
import { ScannableCodePanel } from "@shared/components/ScannableCodePanel";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";

type PackingSlipDetailPanelProps = {
  data: PackingSlipDetailSnapshot;
  error: string | null;
  isLoading: boolean;
  isSubmittingReturn: boolean;
  isExportingPdf: boolean;
  isExportingInsurancePdf: boolean;
  onReturnItems: (assetIds: string[], conditionIn?: string, notes?: string) => Promise<void>;
  onExportPdf: () => Promise<void>;
  onExportInsurancePdf: () => Promise<void>;
};

const conditionOptions = ["Good", "Review", "Damaged"] as const;

export const PackingSlipDetailPanel = ({
  data,
  error,
  isLoading,
  isSubmittingReturn,
  isExportingPdf,
  isExportingInsurancePdf,
  onReturnItems,
  onExportPdf,
  onExportInsurancePdf,
}: PackingSlipDetailPanelProps) => {
  const { t } = useTranslation();
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [conditionIn, setConditionIn] = useState("Good");
  const [notes, setNotes] = useState("");
  const pendingAssetIds = useMemo(
    () => data.items.filter((item) => item.status === "Out").map((item) => item.assetId),
    [data.items],
  );

  if (isLoading) {
    return (
      <SurfaceCard className="packing-detail-card" title={t("packing.detail.title")}>
        <TableSkeleton body={t("packing.detail.loading")} columns={5} />
      </SurfaceCard>
    );
  }

  if (error) {
    return (
      <SurfaceCard className="packing-detail-card" title={t("packing.detail.title")}>
        <div className="empty-state">{t("packing.detail.unableLoad")}</div>
      </SurfaceCard>
    );
  }

  if (!data.slip) {
    return (
      <SurfaceCard className="packing-detail-card" title={t("packing.detail.title")}>
        <div className="empty-state">{t("packing.detail.chooseSlip")}</div>
      </SurfaceCard>
    );
  }

  const selectedPendingAssetIds = pendingAssetIds.filter((assetId) => selectedItemIds.includes(assetId));
  const missingInsuranceValueCount = data.items.filter((item) => item.unitInsuredValueAmount === null).length;
  const insuredItemsCount = data.items.length - missingInsuranceValueCount;
  const operationalQuantity = data.items.reduce((total, item) => total + item.quantity, 0);
  const missingInsuranceItems = data.items.filter((item) => item.unitInsuredValueAmount === null).slice(0, 4);
  const returnLabel = selectedPendingAssetIds.length
    ? t("packing.detail.returnSelected", { count: selectedPendingAssetIds.length })
    : t("packing.detail.returnAllPending", { count: pendingAssetIds.length });
  const headerActions = (
    <div className="packing-detail-header-actions">
      <StatusBadge tone={data.slip.status === "Overdue" ? "critical" : data.slip.status === "Closed" ? "success" : "info"}>
        {t(`packing.statuses.${data.slip.status}`, { defaultValue: data.slip.status })}
      </StatusBadge>
      <button
        className="ghost-control action-row-button"
        disabled={isExportingPdf}
        onClick={() => void onExportPdf()}
        type="button"
      >
        <Download size={14} />
        <span>{isExportingPdf ? t("packing.detail.exporting") : t("packing.detail.exportSlip")}</span>
      </button>
      <button
        className="action-primary-button action-row-button"
        disabled={isSubmittingReturn || !pendingAssetIds.length}
        onClick={() => void onReturnItems(selectedPendingAssetIds.length ? selectedPendingAssetIds : pendingAssetIds, conditionIn, notes)}
        type="button"
      >
        <RotateCcw size={14} />
        <span>{isSubmittingReturn ? t("packing.detail.returning") : returnLabel}</span>
      </button>
      <button
        className="ghost-control action-row-button"
        disabled={isExportingInsurancePdf}
        onClick={() => void onExportInsurancePdf()}
        type="button"
      >
        <FileText size={14} />
        <span>{isExportingInsurancePdf ? t("packing.detail.exporting") : t("packing.detail.exportInsurance")}</span>
      </button>
    </div>
  );

  return (
    <SurfaceCard
      className="packing-detail-card"
      title={data.slip.number}
      aside={headerActions}
    >
      <div className="summary-grid">
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.project")}</span>
          <span className="summary-value">{data.slip.project}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.responsible")}</span>
          <span className="summary-value">{data.slip.responsible}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.preparedBy")}</span>
          <span className="summary-value">{data.slip.preparedBy}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.issuedDue")}</span>
          <span className="summary-value">
            {data.slip.issueDate} · {data.slip.dueDate}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.unitsOnSlip")}</span>
          <span className="summary-value">{data.slip.itemCount}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.returnProgress")}</span>
          <span className="summary-value">
            {t("packing.progress", { returned: data.slip.returnedCount, pending: data.slip.pendingCount })}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.qrReady")}</span>
          <span className="summary-value">{data.slip.primaryCodeValue}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.notes")}</span>
          <span className="summary-value">{data.slip.notes}</span>
        </div>
      </div>

      <div className="packing-detail-summary-grid">
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.items")}</span>
          <span className="summary-value">{data.items.length}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.operationalQty")}</span>
          <span className="summary-value">{operationalQuantity}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.insuredTotal")}</span>
          <span className="summary-value">{data.slip.insuredTotal}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.insuranceValues")}</span>
          <span className="summary-value">
            {t("packing.detail.insuranceValuesProgress", { ready: insuredItemsCount, pending: missingInsuranceValueCount })}
          </span>
        </div>
      </div>

      {data.slip.primaryCodeValue ? (
        <ScannableCodePanel
          codeValue={data.slip.primaryCodeValue}
          subtitle={t("packing.detail.slipCode")}
          title={data.slip.number}
          qrLabel={t("packing.detail.slipQr")}
          barcodeLabel={t("packing.detail.slipBarcode")}
        />
      ) : null}

      {missingInsuranceValueCount ? (
        <div className="packing-insurance-warning">
          <ShieldAlert size={16} />
          <div>
            <strong>{t("packing.detail.missingInsuranceTitle", { count: missingInsuranceValueCount })}</strong>
            <span>
              {t("packing.detail.missingInsuranceBody")}
            </span>
            {missingInsuranceItems.length ? (
              <span>
                {t("packing.detail.pendingInsurance", {
                  items: missingInsuranceItems.map((item) => `${item.code} ${item.asset}`).join(", "),
                  more: missingInsuranceValueCount > missingInsuranceItems.length ? t("packing.detail.moreItems", { count: missingInsuranceValueCount - missingInsuranceItems.length }) : "",
                })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">{t("packing.detail.conditionIn")}</span>
          <SelectField onChange={(event) => setConditionIn(event.target.value)} value={conditionIn}>
            {conditionOptions.map((option) => (
              <option key={option} value={option}>
                {t(`packing.conditions.${option}`)}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">{t("packing.detail.returnNote")}</span>
          <input
            className="action-field-control"
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("packing.builder.optionalNote")}
            value={notes}
          />
        </label>
      </div>

      <DataTable
        getRowId={(row) => row.assetId}
        maxHeight="min(56vh, 620px)"
        persistKey="packing-slip-detail-items"
        columns={[
          {
            key: "asset",
            label: t("packing.detail.columns.asset"),
            width: 240,
            minWidth: 180,
            render: (row) => (
              <div className="identity-cell">
                <span className="identity-title">{row.asset}</span>
                <span className="identity-meta">{row.code}</span>
              </div>
            ),
          },
          { key: "quantity", label: t("packing.detail.columns.units"), align: "right", width: 72, minWidth: 60, render: (row) => row.quantity },
          { key: "conditionOut", label: t("packing.detail.columns.conditionOut"), width: 116, minWidth: 100, render: (row) => t(`packing.conditions.${row.conditionOut}`, { defaultValue: row.conditionOut }) },
          { key: "conditionIn", label: t("packing.detail.columns.conditionIn"), width: 116, minWidth: 100, render: (row) => t(`packing.conditions.${row.conditionIn}`, { defaultValue: row.conditionIn }) },
          { key: "location", label: t("packing.detail.columns.location"), width: 170, minWidth: 136, render: (row) => row.location },
          { key: "responsible", label: t("packing.detail.columns.responsible"), width: 150, minWidth: 124, render: (row) => row.responsible },
          {
            key: "status",
            label: t("packing.detail.columns.status"),
            width: 100,
            minWidth: 88,
            render: (row) => (
              <StatusBadge tone={row.status === "Returned" ? "success" : "info"}>
                {t(`packing.itemStatuses.${row.status}`, { defaultValue: row.status })}
              </StatusBadge>
            ),
          },
          { key: "returnedAt", label: t("packing.detail.columns.returnedAt"), width: 140, minWidth: 120, render: (row) => row.returnedAt },
        ]}
        rows={data.items}
        selectable
        selectedRowIds={selectedItemIds}
        onSelectedRowIdsChange={setSelectedItemIds}
      />
    </SurfaceCard>
  );
};
