import { Check, FileText, MoreVertical, RotateCcw, ShieldAlert, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CurrencyRateSource, CurrencyRateType, PackingInsuranceExportOptions, PackingSlipDetailSnapshot } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { ModalShell } from "@shared/components/ModalShell";
import { ScannableCodePanel } from "@shared/components/ScannableCodePanel";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useCurrencySettings, useExchangeRates } from "@features/finance/useCurrencyData";
import { presentAssetCondition } from "@shared/lib/assetStatusPresentation";

type PackingSlipDetailPanelProps = {
  data: PackingSlipDetailSnapshot;
  error: string | null;
  isLoading: boolean;
  isSubmittingReturn: boolean;
  isExportingPdf: boolean;
  isExportingInsurancePdf: boolean;
  onReturnItems: (assetIds: string[], conditionIn?: string, notes?: string) => Promise<void>;
  onExportPdf: () => Promise<void>;
  onExportInsurancePdf: (options: PackingInsuranceExportOptions) => Promise<void>;
  onClose?: () => void;
};

const conditionOptions = ["Good", "Review", "Damaged"] as const;
const insuranceCurrencyOptions = ["USD", "DOP"] as const;
const rateSources: CurrencyRateSource[] = ["manual", "banco_popular", "banco_central", "banco_santa_cruz", "custom"];
const rateTypes: CurrencyRateType[] = ["buy", "sell", "average", "manual"];

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
  onClose,
}: PackingSlipDetailPanelProps) => {
  const { t } = useTranslation();
  const { activeWorkspaceId } = useWorkspace();
  const { data: currencySettings } = useCurrencySettings(activeWorkspaceId);
  const { data: usdDopRates } = useExchangeRates(activeWorkspaceId, { baseCurrency: "USD", quoteCurrency: "DOP", limit: 200 });
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [conditionIn, setConditionIn] = useState("Good");
  const [notes, setNotes] = useState("");
  const [insuranceDialogOpen, setInsuranceDialogOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const pendingAssetIds = useMemo(
    () => data.items.filter((item) => item.status === "Out").map((item) => item.assetId),
    [data.items],
  );

  useEffect(() => {
    if (!actionsOpen) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !actionsRef.current?.contains(target)) {
        setActionsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionsOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [actionsOpen]);

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
  const returnHint = selectedPendingAssetIds.length
    ? t("packing.detail.returnSelectedHint", { count: selectedPendingAssetIds.length })
    : t("packing.detail.returnAllHint", { count: pendingAssetIds.length });
  const defaultRateSource = currencySettings?.defaultRateSource ?? "manual";
  const defaultRateType = currencySettings?.defaultRateType ?? "manual";
  const defaultOutputCurrency = currencySettings?.baseCurrency === "DOP" ? "DOP" : "USD";
  const hasOperationalNotes = Boolean(data.slip.notes?.trim());
  const conditionChip = (value: string | null | undefined) => {
    if (!value?.trim()) {
      return "—";
    }
    const presented = presentAssetCondition(value, t);
    return <StatusBadge tone={presented.tone}>{presented.label}</StatusBadge>;
  };
  const headerActions = (
    <div className="packing-detail-header-actions detail-header-actions-stacked">
      {onClose ? (
        <button aria-label={t("packing.detail.close")} className="icon-ghost-control" onClick={onClose} type="button">
          <X size={14} />
        </button>
      ) : null}
      <div className="detail-header-chips">
      <StatusBadge tone={data.slip.status === "Overdue" ? "critical" : data.slip.status === "Closed" ? "success" : "info"}>
        {t(`packing.statuses.${data.slip.status}`, { defaultValue: data.slip.status })}
      </StatusBadge>
      <div className="packing-detail-actions-menu" ref={actionsRef}>
        <button
          aria-expanded={actionsOpen}
          aria-label={t("packing.detail.actionsMenu")}
          className="icon-ghost-control packing-detail-actions-trigger"
          onClick={() => setActionsOpen((value) => !value)}
          type="button"
        >
          <MoreVertical size={17} />
        </button>
        {actionsOpen ? (
          <div className="packing-detail-actions-popover" role="menu">
            <button
              disabled={isExportingPdf}
              onClick={() => {
                setActionsOpen(false);
                void onExportPdf();
              }}
              type="button"
            >
              <Upload size={14} />
              <span>{isExportingPdf ? t("packing.detail.exporting") : t("packing.detail.exportSlip")}</span>
            </button>
            <button
              disabled={isExportingInsurancePdf}
              onClick={() => {
                setActionsOpen(false);
                setInsuranceDialogOpen(true);
              }}
              type="button"
            >
              <FileText size={14} />
              <span>{isExportingInsurancePdf ? t("packing.detail.exporting") : t("packing.detail.exportInsurance")}</span>
            </button>
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );

  return (
    <SurfaceCard
      className="packing-detail-card"
      subtitle={t("packing.detail.subtitle", {
        project: data.slip.project,
        responsible: data.slip.responsible,
      })}
      title={data.slip.number}
      aside={headerActions}
    >
      <div className="packing-detail-hero-grid packing-detail-operations-grid">
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.project")}</span>
          <span className="summary-value">{data.slip.project}</span>
          <span className="summary-meta">{data.slip.projectCode} · {data.slip.department}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.owner")}</span>
          <span className="summary-value">{data.slip.responsible}</span>
          <span className="summary-meta">{t("packing.detail.preparedByShort", { name: data.slip.preparedBy })}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.issuedDue")}</span>
          <span className="summary-value">
            {data.slip.issueDate} · {data.slip.dueDate}
          </span>
          <span className="summary-meta">{t("packing.detail.issueDateShort", { date: data.slip.issueDateCompact })}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.detail.returnProgress")}</span>
          <span className="summary-value">
            {t("packing.progress", { returned: data.slip.returnedCount, pending: data.slip.pendingCount })}
          </span>
          <span className="summary-meta">{t("packing.detail.unitsSummary", { count: operationalQuantity })}</span>
        </div>
      </div>

      <div className="packing-detail-meta-strip" aria-label={t("packing.detail.documentContext")}>
        <span>
          <strong>{t("packing.detail.insuranceValues")}</strong>
          {t("packing.detail.insuranceValuesProgress", { ready: insuredItemsCount, pending: missingInsuranceValueCount })}
        </span>
        <span>
          <strong>{t("packing.detail.insuredTotal")}</strong>
          {data.slip.insuredTotal}
        </span>
        <span>
          <strong>{t("packing.detail.qrReady")}</strong>
          {data.slip.primaryCodeValue}
        </span>
      </div>

      {hasOperationalNotes ? (
        <div className="packing-detail-note">
          <span>{t("packing.detail.notes")}</span>
          <strong>{data.slip.notes}</strong>
        </div>
      ) : null}

      {data.slip.primaryCodeValue ? (
        <details className="detail-disclosure packing-code-disclosure">
          <summary className="detail-disclosure-summary">{t("packing.detail.showCodes")}</summary>
          <div className="detail-disclosure-content">
            <ScannableCodePanel
              codeValue={data.slip.primaryCodeValue}
              subtitle={t("packing.detail.slipCode")}
              title={data.slip.number}
              qrLabel={t("packing.detail.slipQr")}
              barcodeLabel={t("packing.detail.slipBarcode")}
            />
          </div>
        </details>
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

      {pendingAssetIds.length ? (
        <>
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

          <div className="packing-return-action-row">
            <span className="packing-return-hint">{returnHint}</span>
            <button
              className="action-primary-button"
              disabled={isSubmittingReturn}
              onClick={() => void onReturnItems(selectedPendingAssetIds.length ? selectedPendingAssetIds : pendingAssetIds, conditionIn, notes)}
              type="button"
            >
              <RotateCcw size={14} />
              <span>{isSubmittingReturn ? t("packing.detail.returning") : returnLabel}</span>
            </button>
          </div>
        </>
      ) : (
        <div className="packing-return-complete">
          <Check size={14} />
          <span>{t("packing.detail.allReturned")}</span>
        </div>
      )}

      <DataTable
        defaultVisibleColumnKeys={["asset", "quantity", "conditionIn", "status"]}
        getRowId={(row) => row.assetId}
        maxHeight="min(42vh, 460px)"
        persistKey="packing-slip-detail-items-v2"
        columns={[
          {
            key: "asset",
            label: t("packing.detail.columns.asset"),
            width: 240,
            minWidth: 180,
            render: (row) => (
              <div className="identity-cell">
                <span className="identity-title">{row.asset}</span>
                <span className="identity-meta">
                  {row.code}
                  {row.kitId ? (
                    <span className="packing-kit-chip" data-tooltip={row.kitCode || undefined}>
                      {t("packing.detail.kitChip", { defaultValue: "Paquete · {{kit}}", kit: row.kitName })}
                    </span>
                  ) : null}
                </span>
              </div>
            ),
          },
          { key: "quantity", label: t("packing.detail.columns.units"), align: "right", width: 72, minWidth: 60, render: (row) => row.quantity },
          { key: "conditionOut", label: t("packing.detail.columns.conditionOut"), width: 116, minWidth: 100, render: (row) => conditionChip(row.conditionOut) },
          { key: "conditionIn", label: t("packing.detail.columns.conditionIn"), width: 116, minWidth: 100, render: (row) => conditionChip(row.conditionIn) },
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
      {insuranceDialogOpen ? (
        <InsuranceExportDialog
          defaultOutputCurrency={defaultOutputCurrency}
          defaultRateSource={defaultRateSource}
          defaultRateType={defaultRateType}
          isSubmitting={isExportingInsurancePdf}
          rates={usdDopRates}
          onClose={() => setInsuranceDialogOpen(false)}
          onExport={async (options) => {
            await onExportInsurancePdf(options);
            setInsuranceDialogOpen(false);
          }}
        />
      ) : null}
    </SurfaceCard>
  );
};

const sourceLabel = (source: CurrencyRateSource) => {
  if (source === "banco_popular") return "Banco Popular";
  if (source === "banco_central") return "Banco Central";
  if (source === "banco_santa_cruz") return "Banco Santa Cruz";
  if (source === "custom") return "Personalizada";
  return "Manual";
};

const InsuranceExportDialog = ({
  defaultOutputCurrency,
  defaultRateSource,
  defaultRateType,
  isSubmitting,
  onClose,
  onExport,
  rates,
}: {
  defaultOutputCurrency: "USD" | "DOP";
  defaultRateSource: CurrencyRateSource;
  defaultRateType: CurrencyRateType;
  isSubmitting: boolean;
  onClose: () => void;
  onExport: (options: PackingInsuranceExportOptions) => Promise<void>;
  rates: Array<{
    rate: number;
    source: CurrencyRateSource;
    sourceLabel: string | null;
    rateType: CurrencyRateType;
    effectiveDate: string;
  }>;
}) => {
  const { t } = useTranslation();
  const [outputCurrency, setOutputCurrency] = useState<"USD" | "DOP">(defaultOutputCurrency);
  const [mode, setMode] = useState<"automatic" | "manual">(defaultRateSource === "manual" ? "manual" : "automatic");
  const [rateSource, setRateSource] = useState<CurrencyRateSource>(defaultRateSource);
  const [rateType, setRateType] = useState<CurrencyRateType>(defaultRateType);
  const automaticRate = useMemo(
    () =>
      rates.find((rate) => rate.source === rateSource && rate.rateType === rateType) ??
      rates.find((rate) => rate.source === rateSource) ??
      null,
    [rateSource, rateType, rates],
  );
  const [manualRate, setManualRate] = useState("");
  const effectiveRate = outputCurrency === "USD" ? 1 : mode === "automatic" ? automaticRate?.rate ?? null : Number.parseFloat(manualRate.replace(/,/g, ""));
  const canExport = outputCurrency === "USD" || (Number.isFinite(effectiveRate) && Number(effectiveRate) > 0);

  useEffect(() => {
    if (outputCurrency === "USD") return;
    if (mode === "automatic" && automaticRate?.rate) {
      setManualRate(String(automaticRate.rate));
    }
  }, [automaticRate?.rate, mode, outputCurrency]);

  const submit = async () => {
    if (!canExport || !effectiveRate) return;
    await onExport({
      outputCurrency,
      exchangeRate: outputCurrency === "USD" ? 1 : Number(effectiveRate),
      exchangeRateSource: outputCurrency === "USD" ? "manual" : mode === "manual" ? "manual" : rateSource,
      exchangeRateType: outputCurrency === "USD" ? "manual" : mode === "manual" ? "manual" : rateType,
      exchangeRateEffectiveDate: outputCurrency === "USD" ? null : mode === "automatic" ? automaticRate?.effectiveDate ?? null : new Date().toISOString().slice(0, 10),
      exchangeRateSourceLabel: outputCurrency === "USD" ? "No conversion" : mode === "automatic" ? automaticRate?.sourceLabel ?? sourceLabel(rateSource) : "Manual",
      mode: outputCurrency === "USD" ? "manual" : mode,
    });
  };

  return (
    <ModalShell backdropClassName="compare-dialog-backdrop" className="packing-insurance-export-dialog" onClose={isSubmitting ? () => undefined : onClose} width={620}>
      <div className="document-preview-header">
        <span className="document-preview-title">{t("packing.insuranceExport.title", { defaultValue: "Exportar listado de seguro" })}</span>
        <button className="icon-ghost-control" onClick={onClose} type="button" aria-label="Close" disabled={isSubmitting}>
          <X size={16} />
        </button>
      </div>
      <div className="packing-insurance-export-body">
        <div className="packing-insurance-export-grid">
          <label>
            <span>{t("packing.insuranceExport.currency", { defaultValue: "Moneda del PDF" })}</span>
            <SelectField value={outputCurrency} onChange={(event) => setOutputCurrency(event.target.value as "USD" | "DOP")}>
              {insuranceCurrencyOptions.map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </SelectField>
          </label>
          <label>
            <span>{t("packing.insuranceExport.mode", { defaultValue: "Tasa" })}</span>
            <SelectField value={mode} onChange={(event) => setMode(event.target.value as "automatic" | "manual")} disabled={outputCurrency === "USD"}>
              <option value="automatic">{t("packing.insuranceExport.automatic", { defaultValue: "Automática" })}</option>
              <option value="manual">{t("packing.insuranceExport.manual", { defaultValue: "Manual" })}</option>
            </SelectField>
          </label>
          <label>
            <span>{t("packing.insuranceExport.source", { defaultValue: "Banco/fuente" })}</span>
            <SelectField value={rateSource} onChange={(event) => setRateSource(event.target.value as CurrencyRateSource)} disabled={outputCurrency === "USD" || mode === "manual"}>
              {rateSources.map((source) => (
                <option key={source} value={source}>{sourceLabel(source)}</option>
              ))}
            </SelectField>
          </label>
          <label>
            <span>{t("packing.insuranceExport.rateType", { defaultValue: "Tipo" })}</span>
            <SelectField value={rateType} onChange={(event) => setRateType(event.target.value as CurrencyRateType)} disabled={outputCurrency === "USD" || mode === "manual"}>
              {rateTypes.map((type) => (
                <option key={type} value={type}>{t(`packing.insuranceExport.rateTypes.${type}`, { defaultValue: type })}</option>
              ))}
            </SelectField>
          </label>
          <label className="packing-insurance-export-rate">
            <span>{t("packing.insuranceExport.rateValue", { defaultValue: "Tasa USD → DOP" })}</span>
            <input
              className="field-input"
              disabled={outputCurrency === "USD" || mode === "automatic"}
              inputMode="decimal"
              value={outputCurrency === "USD" ? "1" : mode === "automatic" ? (automaticRate?.rate ? String(automaticRate.rate) : "") : manualRate}
              placeholder="0.00"
              onChange={(event) => setManualRate(event.target.value.replace(/[^\d.,]/g, ""))}
            />
          </label>
        </div>
        <div className={`action-feedback ${canExport ? "action-feedback-info" : "action-feedback-warning"}`}>
          {outputCurrency === "USD"
            ? t("packing.insuranceExport.usdNote", { defaultValue: "Los valores asegurados ya están registrados en USD; no se aplicará conversión." })
            : canExport
              ? t("packing.insuranceExport.snapshotNote", {
                  defaultValue: "El PDF guardará esta tasa como snapshot visible para auditoría.",
                })
              : t("packing.insuranceExport.missingRate", {
                  defaultValue: "No hay una tasa automática para esa fuente/tipo. Cambia a manual o actualiza las tasas.",
                })}
        </div>
      </div>
      <div className="document-preview-header packing-insurance-export-footer">
        <button className="ghost-control" type="button" onClick={onClose} disabled={isSubmitting}>
          {t("common.cancel", { defaultValue: "Cancelar" })}
        </button>
        <button className="action-primary-button" type="button" onClick={() => void submit()} disabled={isSubmitting || !canExport}>
          <Check size={15} />
          <span>{isSubmitting ? t("common.exporting", { defaultValue: "Exportando..." }) : t("packing.detail.exportInsurance")}</span>
        </button>
      </div>
    </ModalShell>
  );
};
