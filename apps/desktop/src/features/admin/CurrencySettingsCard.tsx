import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CurrencyRateSource, CurrencyRateType } from "@contracts";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { NumberStepper } from "@shared/components/NumberStepper";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { newCommandId } from "@features/finance/quoteHelpers";
import {
  refreshCurrencyRates,
  saveCurrencyRateProviderConfig,
  useCurrencyRateProviderStatus,
  useCurrencySettings,
  useExchangeRates,
} from "@features/finance/useCurrencyData";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

const enabledCurrencyOptions = ["DOP", "USD", "EUR"];
const RATE_SOURCE_VALUES: CurrencyRateSource[] = ["manual", "banco_popular", "banco_central", "banco_santa_cruz", "custom"];
const RATE_TYPE_VALUES: CurrencyRateType[] = ["buy", "sell", "average", "manual"];
const tasaRealAuthBlockStorageKey = (workspaceId: string) => `bukowski:fx-auth-blocked:${workspaceId}:tasareal`;

export const CurrencySettingsCard = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { createNotification } = useNotifications();
  const { activeWorkspaceId } = useWorkspace();
  const { data: settings, refresh } = useCurrencySettings(activeWorkspaceId);
  const { data: rates, refresh: refreshRates } = useExchangeRates(activeWorkspaceId, { limit: 10 });
  const { data: providerStatus, refresh: refreshProviderStatus } = useCurrencyRateProviderStatus(activeWorkspaceId);

  const [baseCurrency, setBaseCurrency] = useState("DOP");
  const [defaultQuoteCurrency, setDefaultQuoteCurrency] = useState("DOP");
  const [defaultItbisRate, setDefaultItbisRate] = useState(0.18);
  const [defaultQuoteValidityDays, setDefaultQuoteValidityDays] = useState(30);
  const [sirecineNumber, setSirecineNumber] = useState("");
  const [enabled, setEnabled] = useState<string[]>(enabledCurrencyOptions);
  const [isSaving, setIsSaving] = useState(false);

  // New rate form
  const [newRateBase, setNewRateBase] = useState("USD");
  const [newRateQuote, setNewRateQuote] = useState("DOP");
  const [newRateValue, setNewRateValue] = useState("");
  const [newRateDate, setNewRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [newRateSource, setNewRateSource] = useState<CurrencyRateSource>("manual");
  const [newRateType, setNewRateType] = useState<CurrencyRateType>("sell");
  const [isAddingRate, setIsAddingRate] = useState(false);
  const [providerApiKey, setProviderApiKey] = useState("");
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isRefreshingProvider, setIsRefreshingProvider] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setBaseCurrency(settings.baseCurrency);
    setDefaultQuoteCurrency(settings.defaultQuoteCurrency);
    setDefaultItbisRate(settings.defaultItbisRate);
    setDefaultQuoteValidityDays(settings.defaultQuoteValidityDays);
    setSirecineNumber(settings.sirecineNumber ?? "");
    setEnabled(settings.enabledCurrencies);
  }, [settings]);

  const handleSave = async () => {
    if (!window.bukowskiCurrency || !settings) return;
    if (!enabled.includes(baseCurrency)) {
      toast.error(
        t("settings.workspace.currencyCard.toasts.baseMissingTitle"),
        t("settings.workspace.currencyCard.toasts.baseMissingBody"),
      );
      return;
    }
    setIsSaving(true);
    try {
      await window.bukowskiCurrency.upsertSettings({
        commandId: newCommandId("currency-save"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        baseCurrency,
        defaultQuoteCurrency,
        enabledCurrencies: enabled,
        defaultRateSource: settings.defaultRateSource,
        defaultRateType: settings.defaultRateType,
        defaultItbisRate,
        defaultQuoteValidityDays,
        sirecineNumber: sirecineNumber.trim() || null,
        ncfSeriesActive: settings.ncfSeriesActive,
        ncfSequenceNext: settings.ncfSequenceNext,
        ncfSequenceMax: settings.ncfSequenceMax,
        ncfExpiresAt: settings.ncfExpiresAt,
        workspaceLogoUrl: settings.workspaceLogoUrl,
        workspaceSealUrl: settings.workspaceSealUrl,
        workspaceSignatureUrl: settings.workspaceSignatureUrl,
      });
      toast.success(
        t("settings.workspace.currencyCard.toasts.savedTitle"),
        t("settings.workspace.currencyCard.toasts.savedBody"),
      );
      refresh();
    } catch (error) {
      toast.error(t("common.couldNotSave"), getUserFacingErrorMessage(error, t("common.tryAgain")));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRate = async () => {
    if (!window.bukowskiCurrency) return;
    const rate = Number(newRateValue);
    if (!rate || rate <= 0) {
      toast.error(
        t("settings.workspace.currencyCard.toasts.rateRequiredTitle"),
        t("settings.workspace.currencyCard.toasts.rateRequiredBody"),
      );
      return;
    }
    if (newRateBase === newRateQuote) {
      toast.error(
        t("settings.workspace.currencyCard.toasts.currenciesMatchTitle"),
        t("settings.workspace.currencyCard.toasts.currenciesMatchBody"),
      );
      return;
    }
    setIsAddingRate(true);
    try {
      await window.bukowskiCurrency.createRate({
        commandId: newCommandId("rate-add"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        baseCurrency: newRateBase,
        quoteCurrency: newRateQuote,
        rate,
        rateType: newRateType,
        source: newRateSource,
        sourceLabel: t(`settings.workspace.currencyCard.rateSources.${newRateSource}`),
        effectiveDate: newRateDate,
      });
      setNewRateValue("");
      refreshRates();
      toast.success(
        t("settings.workspace.currencyCard.toasts.rateAddedTitle"),
        t("settings.workspace.currencyCard.toasts.rateAddedBody", {
          base: newRateBase,
          quote: newRateQuote,
          rate,
          type: t(`settings.workspace.currencyCard.rateTypes.${newRateType}`),
          date: newRateDate,
        }),
      );
    } catch (error) {
      toast.error(
        t("settings.workspace.currencyCard.toasts.couldNotAddRate"),
        getUserFacingErrorMessage(error, t("common.tryAgain")),
      );
    } finally {
      setIsAddingRate(false);
    }
  };

  const handleDeleteRate = async (rateId: string) => {
    if (!window.bukowskiCurrency) return;
    try {
      await window.bukowskiCurrency.deleteRate({
        commandId: newCommandId("rate-del"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        rateId,
      });
      refreshRates();
      toast.success(
        t("settings.workspace.currencyCard.toasts.rateRemovedTitle"),
        t("settings.workspace.currencyCard.toasts.rateRemovedBody"),
      );
    } catch (error) {
      toast.error(
        t("settings.workspace.currencyCard.toasts.couldNotRemove"),
        getUserFacingErrorMessage(error, t("common.tryAgain")),
      );
    }
  };

  const handleSaveProvider = async () => {
    setIsSavingProvider(true);
    try {
      const result = await saveCurrencyRateProviderConfig({
        workspaceId: activeWorkspaceId,
        provider: "tasareal",
        apiKey: providerApiKey.trim() || null,
      });
      setProviderApiKey("");
      window.localStorage.removeItem(tasaRealAuthBlockStorageKey(activeWorkspaceId));
      refreshProviderStatus();
      toast.success(t("settings.workspace.currencyCard.toasts.providerConnectedTitle"), result.summary);
    } catch (error) {
      toast.error(
        t("settings.workspace.currencyCard.toasts.couldNotSaveKey"),
        getUserFacingErrorMessage(error, t("settings.workspace.currencyCard.toasts.couldNotSaveKeyBody")),
      );
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleClearProvider = async () => {
    setIsSavingProvider(true);
    try {
      const result = await saveCurrencyRateProviderConfig({
        workspaceId: activeWorkspaceId,
        provider: "tasareal",
        clearApiKey: true,
      });
      window.localStorage.removeItem(tasaRealAuthBlockStorageKey(activeWorkspaceId));
      refreshProviderStatus();
      toast.success(t("settings.workspace.currencyCard.toasts.providerDisconnectedTitle"), result.summary);
    } catch (error) {
      toast.error(
        t("settings.workspace.currencyCard.toasts.couldNotDisconnect"),
        getUserFacingErrorMessage(error, t("common.tryAgain")),
      );
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleRefreshProvider = async () => {
    setIsRefreshingProvider(true);
    try {
      const result = await refreshCurrencyRates({
        commandId: newCommandId("fx-refresh"),
        workspaceId: activeWorkspaceId,
        provider: "tasareal",
        currency: "USD",
      });
      refreshRates();
      refreshProviderStatus();
      toast.success(t("settings.workspace.currencyCard.toasts.ratesRefreshedTitle"), result.summary);
      await createNotification({
        kind: "exchange_rate",
        title: t("settings.workspace.currencyCard.notifications.refreshedTitle", { defaultValue: "Tasas actualizadas" }),
        body: result.summary,
        linkTo: "/settings/workspace",
        sourceType: "exchange_rate",
        sourceRef: { provider: "tasareal", currency: "USD" },
        notifyNow: true,
      });
    } catch (error) {
      await createNotification({
        kind: "exchange_rate",
        title: t("settings.workspace.currencyCard.notifications.refreshFailedTitle", { defaultValue: "No se actualizaron las tasas" }),
        body: getUserFacingErrorMessage(error, t("settings.workspace.currencyCard.toasts.couldNotRefreshBody")),
        linkTo: "/settings/workspace",
        sourceType: "exchange_rate",
        sourceRef: { provider: "tasareal", currency: "USD", status: "failed" },
        notifyNow: true,
      }).catch(() => undefined);
      toast.error(
        t("settings.workspace.currencyCard.toasts.couldNotRefresh"),
        getUserFacingErrorMessage(error, t("settings.workspace.currencyCard.toasts.couldNotRefreshBody")),
      );
    } finally {
      setIsRefreshingProvider(false);
    }
  };

  if (!settings) return null;

  return (
    <SurfaceCard
      title={t("settings.workspace.currencyCard.cardTitle")}
      subtitle={t("settings.workspace.currencyCard.cardSubtitle")}
    >
      <div className="agent-form-grid">
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.baseCurrency")}</span>
          <select
            className="field-input"
            onChange={(e) => setBaseCurrency(e.target.value)}
            value={baseCurrency}
          >
            {enabledCurrencyOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.defaultQuoteCurrency")}</span>
          <select
            className="field-input"
            onChange={(e) => setDefaultQuoteCurrency(e.target.value)}
            value={defaultQuoteCurrency}
          >
            {enabled.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.defaultItbis")}</span>
          <NumberStepper
            align="left"
            ariaLabel={t("settings.workspace.currencyCard.defaultItbis")}
            max={100}
            min={0}
            onChange={(next) => setDefaultItbisRate(next / 100)}
            precision={2}
            step={0.5}
            suffix="%"
            value={Number((defaultItbisRate * 100).toFixed(2))}
          />
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.defaultValidity")}</span>
          <NumberStepper
            align="left"
            ariaLabel={t("settings.workspace.currencyCard.defaultValidity")}
            max={365}
            min={1}
            onChange={(next) => setDefaultQuoteValidityDays(next)}
            value={defaultQuoteValidityDays}
          />
        </label>
        <label className="field-block field-block-span-2">
          <span className="field-label">{t("settings.workspace.currencyCard.sirecineNumber")}</span>
          <input
            className="field-input"
            onChange={(e) => setSirecineNumber(e.target.value)}
            placeholder="AC-ES 1852"
            value={sirecineNumber}
          />
        </label>
        <label className="field-block field-block-span-2">
          <span className="field-label">{t("settings.workspace.currencyCard.enabledCurrencies")}</span>
          <div className="filter-pill-row">
            {enabledCurrencyOptions.map((code) => {
              const isOn = enabled.includes(code);
              return (
                <button
                  className={`filter-pill${isOn ? " is-active" : ""}`}
                  key={code}
                  onClick={() =>
                    setEnabled((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
                  }
                  type="button"
                >
                  {code}
                </button>
              );
            })}
          </div>
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
          <span>{isSaving ? t("common.saving") : t("settings.workspace.currencyCard.saveDefaults")}</span>
        </button>
      </div>

      <div className="surface-card-divider" />

      <div className="currency-provider-card">
        <div className="currency-provider-copy">
          <strong>{t("settings.workspace.currencyCard.provider.title")}</strong>
          <span>{providerStatus?.summary ?? t("settings.workspace.currencyCard.provider.fallback")}</span>
        </div>
        <div className="currency-provider-controls">
          <input
            className="field-input currency-provider-key-input"
            onChange={(e) => setProviderApiKey(e.target.value)}
            placeholder={
              providerStatus?.hasApiKey
                ? t("settings.workspace.currencyCard.provider.stored")
                : t("settings.workspace.currencyCard.provider.paste")
            }
            type="password"
            value={providerApiKey}
          />
          <button
            className="ghost-control"
            disabled={isSavingProvider || !providerApiKey.trim()}
            onClick={() => void handleSaveProvider()}
            type="button"
          >
            <span>
              {providerStatus?.hasApiKey
                ? t("settings.workspace.currencyCard.provider.update")
                : t("settings.workspace.currencyCard.provider.connect")}
            </span>
          </button>
          <button
            aria-label={t("settings.workspace.currencyCard.provider.refreshTooltip")}
            className="ghost-control"
            disabled={isRefreshingProvider || !providerStatus?.hasApiKey}
            onClick={() => void handleRefreshProvider()}
            title={t("settings.workspace.currencyCard.provider.refreshTooltip")}
            type="button"
          >
            <RefreshCw size={13} />
            <span>
              {isRefreshingProvider
                ? t("settings.workspace.currencyCard.provider.refreshing")
                : t("settings.workspace.currencyCard.provider.refresh")}
            </span>
          </button>
          {providerStatus?.hasApiKey ? (
            <button className="ghost-control is-danger" disabled={isSavingProvider} onClick={() => void handleClearProvider()} type="button">
              {t("settings.workspace.currencyCard.provider.disconnect")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="surface-card-divider" />

      <div className="page-stack-row" style={{ marginBottom: 8 }}>
        <strong>{t("settings.workspace.currencyCard.rates.title")}</strong>
        <small className="text-muted">{t("settings.workspace.currencyCard.rates.subtitle")}</small>
      </div>

      <div className="agent-form-grid">
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.rates.from")}</span>
          <select className="field-input" onChange={(e) => setNewRateBase(e.target.value)} value={newRateBase}>
            {enabledCurrencyOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.rates.to")}</span>
          <select className="field-input" onChange={(e) => setNewRateQuote(e.target.value)} value={newRateQuote}>
            {enabledCurrencyOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.rates.rate")}</span>
          <NumberStepper
            align="left"
            ariaLabel={t("settings.workspace.currencyCard.rates.rate")}
            min={0}
            onChange={(next) => setNewRateValue(String(next))}
            placeholder="60.25"
            precision={4}
            step={0.5}
            value={Number(newRateValue) || 0}
          />
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.rates.institution")}</span>
          <select
            className="field-input"
            onChange={(e) => setNewRateSource(e.target.value as CurrencyRateSource)}
            value={newRateSource}
          >
            {RATE_SOURCE_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`settings.workspace.currencyCard.rateSources.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.rates.rateType")}</span>
          <select className="field-input" onChange={(e) => setNewRateType(e.target.value as CurrencyRateType)} value={newRateType}>
            {RATE_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`settings.workspace.currencyCard.rateTypes.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">{t("settings.workspace.currencyCard.rates.effectiveDate")}</span>
          <input
            className="field-input"
            onChange={(e) => setNewRateDate(e.target.value)}
            type="date"
            value={newRateDate}
          />
        </label>
      </div>

      <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
        <button
          className="ghost-control"
          disabled={isAddingRate}
          onClick={() => void handleAddRate()}
          type="button"
        >
          {isAddingRate
            ? t("settings.workspace.currencyCard.rates.addingRate")
            : t("settings.workspace.currencyCard.rates.addRate")}
        </button>
      </div>

      {rates.length > 0 ? (
        <table className="data-table-mini" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>{t("settings.workspace.currencyCard.rates.column.pair")}</th>
              <th>{t("settings.workspace.currencyCard.rates.column.rate")}</th>
              <th>{t("settings.workspace.currencyCard.rates.column.type")}</th>
              <th>{t("settings.workspace.currencyCard.rates.column.effective")}</th>
              <th>{t("settings.workspace.currencyCard.rates.column.source")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <tr key={rate.id}>
                <td>
                  {rate.baseCurrency} → {rate.quoteCurrency}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{rate.rate}</td>
                <td>
                  <small className="text-muted">
                    {RATE_TYPE_VALUES.includes(rate.rateType as CurrencyRateType)
                      ? t(`settings.workspace.currencyCard.rateTypes.${rate.rateType}`)
                      : rate.rateType}
                  </small>
                </td>
                <td>{rate.effectiveDate}</td>
                <td>
                  <small className="text-muted">{rate.sourceLabel ?? rate.source}</small>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="ghost-control is-danger"
                    onClick={() => void handleDeleteRate(rate.id)}
                    type="button"
                  >
                    {t("settings.workspace.currencyCard.rates.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </SurfaceCard>
  );
};

export default CurrencySettingsCard;
