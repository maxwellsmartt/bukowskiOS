import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { evaluateNcfHealth, type NcfHealthStatus } from "@features/finance/ncfHealth";
import { newCommandId } from "@features/finance/quoteHelpers";
import { useCurrencySettings } from "@features/finance/useCurrencyData";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

const ncfHealthFallback: Record<NcfHealthStatus, { status: string; title: string; body: string }> = {
  missing: {
    status: "Sin configurar",
    title: "NCF sin configurar",
    body: "Agrega serie, próxima secuencia y secuencia máxima antes de emitir facturas fiscales.",
  },
  expired: {
    status: "Vencido",
    title: "NCF vencido",
    body: "Actualiza la fecha de vencimiento o carga una nueva serie antes de emitir.",
  },
  exhausted: {
    status: "Agotado",
    title: "NCF agotado",
    body: "La próxima secuencia supera el máximo configurado. Carga una nueva serie.",
  },
  low: {
    status: "Bajo",
    title: "Quedan pocos NCF",
    body: "La serie {{series}} tiene {{count}} secuencias disponibles. Puedes emitir, pero conviene preparar la próxima serie.",
  },
  expiring: {
    status: "Por vencer",
    title: "La serie vence pronto",
    body: "La serie {{series}} vence en {{days}} días. Puedes emitir, pero conviene revisar la renovación.",
  },
  ready: {
    status: "Listo",
    title: "NCF listo para emitir",
    body: "La serie {{series}} tiene {{count}} secuencias disponibles.",
  },
};

export const NcfSettingsCard = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const { data: settings, refresh } = useCurrencySettings(activeWorkspaceId);
  const [ncfSeriesActive, setNcfSeriesActive] = useState("");
  const [ncfSequenceNext, setNcfSequenceNext] = useState<number | null>(null);
  const [ncfSequenceMax, setNcfSequenceMax] = useState<number | null>(null);
  const [ncfExpiresAt, setNcfExpiresAt] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setNcfSeriesActive(settings.ncfSeriesActive ?? "");
    setNcfSequenceNext(settings.ncfSequenceNext);
    setNcfSequenceMax(settings.ncfSequenceMax);
    setNcfExpiresAt(settings.ncfExpiresAt?.slice(0, 10) ?? "");
  }, [settings]);

  const ncfHealth = useMemo(
    () =>
      evaluateNcfHealth({
        ncfSeriesActive,
        ncfSequenceNext,
        ncfSequenceMax,
        ncfExpiresAt,
      }),
    [ncfExpiresAt, ncfSequenceMax, ncfSequenceNext, ncfSeriesActive],
  );

  if (!settings) return null;

  const ncfMeterWidth = `${Math.round((ncfHealth.percentRemaining ?? 0) * 100)}%`;
  const ncfFallback = ncfHealthFallback[ncfHealth.status];
  const ncfCopyParams = {
    series: ncfHealth.series ?? t("settings.workspace.ncfCard.health.noSeries", { defaultValue: "sin serie" }),
    count: ncfHealth.remaining ?? 0,
    days: ncfHealth.daysUntilExpiry ?? 0,
  };

  const handleSave = async () => {
    if (!window.bukowskiCurrency) return;
    setIsSaving(true);
    try {
      await window.bukowskiCurrency.upsertSettings({
        commandId: newCommandId("ncf-save"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        baseCurrency: settings.baseCurrency,
        defaultQuoteCurrency: settings.defaultQuoteCurrency,
        enabledCurrencies: settings.enabledCurrencies,
        defaultRateSource: settings.defaultRateSource,
        defaultRateType: settings.defaultRateType,
        defaultItbisRate: settings.defaultItbisRate,
        defaultQuoteValidityDays: settings.defaultQuoteValidityDays,
        sirecineNumber: settings.sirecineNumber,
        ncfSeriesActive: ncfSeriesActive.trim().toUpperCase() || null,
        ncfSequenceNext,
        ncfSequenceMax,
        ncfExpiresAt: ncfExpiresAt.trim() || null,
        workspaceLogoUrl: settings.workspaceLogoUrl,
        workspaceSealUrl: settings.workspaceSealUrl,
        workspaceSignatureUrl: settings.workspaceSignatureUrl,
      });
      toast.success(
        t("settings.workspace.ncfCard.toasts.savedTitle", { defaultValue: "NCF guardado" }),
        t("settings.workspace.ncfCard.toasts.savedBody", {
          defaultValue: "La próxima factura usará esta configuración fiscal.",
        }),
      );
      refresh();
    } catch (error) {
      toast.error(t("common.couldNotSave"), getUserFacingErrorMessage(error, t("common.tryAgain")));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SurfaceCard
      title={t("settings.workspace.ncfCard.cardTitle", { defaultValue: "Numeración fiscal (NCF)" })}
      subtitle={t("settings.workspace.ncfCard.cardSubtitle", {
        defaultValue: "Serie, secuencia y vencimiento fiscal que se consumen al emitir facturas.",
      })}
    >
      <div className={`ncf-health-card ncf-health-card-${ncfHealth.tone}`}>
        <div className="ncf-health-main">
          <div>
            <div className="ncf-health-title-row">
              <strong>
                {t(`settings.workspace.ncfCard.health.${ncfHealth.status}.title`, {
                  ...ncfCopyParams,
                  defaultValue: ncfFallback.title,
                })}
              </strong>
              <StatusBadge tone={ncfHealth.tone}>
                {t(`settings.workspace.ncfCard.health.status.${ncfHealth.status}`, {
                  defaultValue: ncfFallback.status,
                })}
              </StatusBadge>
            </div>
            <p>
              {t(`settings.workspace.ncfCard.health.${ncfHealth.status}.body`, {
                ...ncfCopyParams,
                defaultValue: ncfFallback.body,
              })}
            </p>
          </div>
          <div className="ncf-health-stat">
            <span>{t("settings.workspace.ncfCard.health.remaining", { defaultValue: "Disponibles" })}</span>
            <strong>{ncfHealth.remaining ?? "—"}</strong>
          </div>
        </div>
        <div className="ncf-health-meter" aria-hidden="true">
          <span className={`ncf-health-meter-fill ncf-health-meter-${ncfHealth.tone}`} style={{ width: ncfMeterWidth }} />
        </div>
      </div>

      <div className="agent-form-grid">
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.ncfCard.series", { defaultValue: "Serie activa" })}</span>
          <input
            className="field-input"
            onChange={(e) => setNcfSeriesActive(e.target.value.toUpperCase())}
            placeholder="B01"
            value={ncfSeriesActive}
          />
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.ncfCard.next", { defaultValue: "Próxima secuencia" })}</span>
          <input
            className="field-input"
            min={1}
            onChange={(e) => setNcfSequenceNext(e.target.value ? Number(e.target.value) : null)}
            placeholder="1"
            type="number"
            value={ncfSequenceNext ?? ""}
          />
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.ncfCard.max", { defaultValue: "Secuencia máxima" })}</span>
          <input
            className="field-input"
            min={1}
            onChange={(e) => setNcfSequenceMax(e.target.value ? Number(e.target.value) : null)}
            placeholder="99999999"
            type="number"
            value={ncfSequenceMax ?? ""}
          />
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.ncfCard.expires", { defaultValue: "Fecha de vencimiento" })}</span>
          <input
            className="field-input"
            onChange={(e) => setNcfExpiresAt(e.target.value)}
            type="date"
            value={ncfExpiresAt}
          />
        </label>
      </div>

      <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
        <button
          className="action-primary-button"
          disabled={isSaving}
          onClick={() => void handleSave()}
          type="button"
        >
          <Save size={13} />
          <span>{isSaving ? t("common.saving") : t("settings.workspace.ncfCard.save", { defaultValue: "Guardar NCF" })}</span>
        </button>
      </div>
    </SurfaceCard>
  );
};

export default NcfSettingsCard;
