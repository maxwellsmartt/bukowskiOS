import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";

import type { CurrencyRateSource, CurrencyRateType } from "@contracts";
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
const rateSourceOptions: Array<{ label: string; value: CurrencyRateSource }> = [
  { label: "Manual", value: "manual" },
  { label: "Banco Popular", value: "banco_popular" },
  { label: "Banco Central", value: "banco_central" },
  { label: "Banco Santa Cruz", value: "banco_santa_cruz" },
  { label: "Other", value: "custom" },
];
const rateTypeOptions: Array<{ label: string; value: CurrencyRateType }> = [
  { label: "Buy", value: "buy" },
  { label: "Sell", value: "sell" },
  { label: "Average", value: "average" },
  { label: "Manual", value: "manual" },
];

export const CurrencySettingsCard = () => {
  const toast = useToast();
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
      toast.error("Base currency missing", "Make sure your base currency is in the enabled list.");
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
        workspaceLogoUrl: settings.workspaceLogoUrl,
        workspaceSealUrl: settings.workspaceSealUrl,
        workspaceSignatureUrl: settings.workspaceSignatureUrl,
      });
      toast.success("Currency settings saved", "These defaults apply to every new quote.");
      refresh();
    } catch (error) {
      toast.error("Could not save", getUserFacingErrorMessage(error, "Try again in a moment."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRate = async () => {
    if (!window.bukowskiCurrency) return;
    const rate = Number(newRateValue);
    if (!rate || rate <= 0) {
      toast.error("Rate required", "Enter a positive number.");
      return;
    }
    if (newRateBase === newRateQuote) {
      toast.error("Currencies match", "Base and quote currencies must differ.");
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
        sourceLabel: rateSourceOptions.find((option) => option.value === newRateSource)?.label ?? null,
        effectiveDate: newRateDate,
      });
      setNewRateValue("");
      refreshRates();
      toast.success("Rate added", `${newRateBase}→${newRateQuote} = ${rate} · ${newRateType} · ${newRateDate}.`);
    } catch (error) {
      toast.error("Could not add rate", getUserFacingErrorMessage(error, "Try again in a moment."));
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
      toast.success("Rate removed", "Older quotes keep their snapshot.");
    } catch (error) {
      toast.error("Could not remove", getUserFacingErrorMessage(error, "Try again in a moment."));
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
      refreshProviderStatus();
      toast.success("Exchange API connected", result.summary);
    } catch (error) {
      toast.error("Could not save API key", getUserFacingErrorMessage(error, "Check the key and try again."));
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
      refreshProviderStatus();
      toast.success("Exchange API disconnected", result.summary);
    } catch (error) {
      toast.error("Could not disconnect", getUserFacingErrorMessage(error, "Try again in a moment."));
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
      toast.success("Rates refreshed", result.summary);
    } catch (error) {
      toast.error("Could not refresh rates", getUserFacingErrorMessage(error, "Check the API connection and try again."));
    } finally {
      setIsRefreshingProvider(false);
    }
  };

  if (!settings) return null;

  return (
    <SurfaceCard title="Currency & rates" subtitle="Base currency, ITBIS default and exchange rates for quotes.">
      <div className="agent-form-grid">
        <label className="field-block">
          <span className="field-label">Base currency</span>
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
          <span className="field-label">Default quote currency</span>
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
          <span className="field-label">Default ITBIS</span>
          <NumberStepper
            align="left"
            ariaLabel="Default ITBIS"
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
          <span className="field-label">Default validity (days)</span>
          <NumberStepper
            align="left"
            ariaLabel="Default validity"
            max={365}
            min={1}
            onChange={(next) => setDefaultQuoteValidityDays(next)}
            value={defaultQuoteValidityDays}
          />
        </label>
        <label className="field-block field-block-span-2">
          <span className="field-label">Sirecine number</span>
          <input
            className="field-input"
            onChange={(e) => setSirecineNumber(e.target.value)}
            placeholder="AC-ES 1852"
            value={sirecineNumber}
          />
        </label>
        <label className="field-block field-block-span-2">
          <span className="field-label">Enabled currencies</span>
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
          <span>{isSaving ? "Saving…" : "Save defaults"}</span>
        </button>
      </div>

      <div className="surface-card-divider" />

      <div className="currency-provider-card">
        <div className="currency-provider-copy">
          <strong>TasaReal API</strong>
          <span>{providerStatus?.summary ?? "Connect an API key to refresh Dominican bank rates."}</span>
        </div>
        <div className="currency-provider-controls">
          <input
            className="field-input currency-provider-key-input"
            onChange={(e) => setProviderApiKey(e.target.value)}
            placeholder={providerStatus?.hasApiKey ? "API key stored" : "Paste API key"}
            type="password"
            value={providerApiKey}
          />
          <button
            className="ghost-control"
            disabled={isSavingProvider || !providerApiKey.trim()}
            onClick={() => void handleSaveProvider()}
            type="button"
          >
            <span>{providerStatus?.hasApiKey ? "Update key" : "Connect"}</span>
          </button>
          <button
            aria-label="Refresh rates from TasaReal"
            className="ghost-control"
            disabled={isRefreshingProvider || !providerStatus?.hasApiKey}
            onClick={() => void handleRefreshProvider()}
            title="Refresh rates from TasaReal"
            type="button"
          >
            <RefreshCw size={13} />
            <span>{isRefreshingProvider ? "Refreshing…" : "Refresh"}</span>
          </button>
          {providerStatus?.hasApiKey ? (
            <button className="ghost-control is-danger" disabled={isSavingProvider} onClick={() => void handleClearProvider()} type="button">
              Disconnect
            </button>
          ) : null}
        </div>
      </div>

      <div className="surface-card-divider" />

      <div className="page-stack-row" style={{ marginBottom: 8 }}>
        <strong>Exchange rates</strong>
        <small className="text-muted">Older quotes keep the rate that was active when they were created.</small>
      </div>

      <div className="agent-form-grid">
        <label className="field-block">
          <span className="field-label">From</span>
          <select className="field-input" onChange={(e) => setNewRateBase(e.target.value)} value={newRateBase}>
            {enabledCurrencyOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">To</span>
          <select className="field-input" onChange={(e) => setNewRateQuote(e.target.value)} value={newRateQuote}>
            {enabledCurrencyOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">Rate</span>
          <NumberStepper
            align="left"
            ariaLabel="New exchange rate"
            min={0}
            onChange={(next) => setNewRateValue(String(next))}
            placeholder="60.25"
            precision={4}
            step={0.5}
            value={Number(newRateValue) || 0}
          />
        </label>
        <label className="field-block">
          <span className="field-label">Institution</span>
          <select
            className="field-input"
            onChange={(e) => setNewRateSource(e.target.value as CurrencyRateSource)}
            value={newRateSource}
          >
            {rateSourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">Rate type</span>
          <select className="field-input" onChange={(e) => setNewRateType(e.target.value as CurrencyRateType)} value={newRateType}>
            {rateTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span className="field-label">Effective date</span>
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
          {isAddingRate ? "Adding…" : "Add rate"}
        </button>
      </div>

      {rates.length > 0 ? (
        <table className="data-table-mini" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Rate</th>
              <th>Type</th>
              <th>Effective</th>
              <th>Source</th>
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
                  <small className="text-muted">{rate.rateType}</small>
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
                    Remove
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
