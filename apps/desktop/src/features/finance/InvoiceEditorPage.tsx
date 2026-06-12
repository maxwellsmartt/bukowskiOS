import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import type {
  CurrencyRateSource,
  CurrencyRateType,
  InvoiceItemInput,
  QuoteItemDurationUnit,
  QuoteItemTaxBehavior,
  QuoteTaxProfile,
} from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { NumberStepper } from "@shared/components/NumberStepper";
import { RequiredLabel } from "@shared/components/RequiredLabel";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";

import { calculateQuotePreview, type CalculateQuotePreviewInput } from "./quoteCalculationPreview";
import { formatCurrency, newCommandId, taxProfileLabel } from "./quoteHelpers";
import { fetchLatestRate, useCurrencySettings } from "./useCurrencyData";
import { useInvoiceDetail, useInvoiceMutations } from "./useInvoiceData";

type Draft = {
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  clientNameSnapshot: string;
  clientRncSnapshot: string;
  productionCompanyNameSnapshot: string;
  productionPurSnapshot: string;
  workspaceSirecineSnapshot: string;
  attentionName: string;
  attentionPhone: string;
  projectNameSnapshot: string;
  productionName: string;
  description: string;
  packageTitle: string;
  currency: string;
  baseCurrency: string;
  exchangeRate: number;
  exchangeRateSource: CurrencyRateSource;
  exchangeRateType: CurrencyRateType;
  exchangeRateEffectiveDate: string;
  taxProfile: QuoteTaxProfile;
  itbisRate: number;
  taxAddedToTotal: boolean;
  observations: string;
  items: InvoiceItemInput[];
};

const today = () => new Date().toISOString().slice(0, 10);

const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};

const emptyItem = (sortOrder: number): InvoiceItemInput => ({
  sortOrder,
  quantity: 1,
  title: "",
  description: null,
  durationValue: null,
  durationUnit: null,
  unitPrice: 0,
  discountRate: null,
  discountAmount: null,
  taxBehavior: "follows_quote",
  taxRate: null,
  notes: null,
});

const emptyDraft = (baseCurrency: string, defaultItbisRate: number): Draft => {
  const issueDate = today();
  return {
    issueDate,
    dueDate: addDays(issueDate, 30),
    paymentTermsDays: 30,
    clientNameSnapshot: "",
    clientRncSnapshot: "",
    productionCompanyNameSnapshot: "",
    productionPurSnapshot: "",
    workspaceSirecineSnapshot: "",
    attentionName: "",
    attentionPhone: "",
    projectNameSnapshot: "",
    productionName: "",
    description: "",
    packageTitle: "",
    currency: baseCurrency,
    baseCurrency,
    exchangeRate: 1,
    exchangeRateSource: "manual",
    exchangeRateType: "manual",
    exchangeRateEffectiveDate: issueDate,
    taxProfile: "standard_itbis",
    itbisRate: defaultItbisRate,
    taxAddedToTotal: true,
    observations: "",
    items: [emptyItem(1)],
  };
};

const taxProfileOptions: QuoteTaxProfile[] = ["standard_itbis", "film_law_exempt", "mixed", "manual"];
const taxBehaviorOptions: QuoteItemTaxBehavior[] = ["follows_quote", "taxable", "exempt", "show_only", "included"];

const cleanIpcMessage = (err: unknown, fallback: string) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
    : fallback;

const normalizeOptional = (value: string) => value.trim() || null;

export const InvoiceEditorPage = () => {
  const { t } = useTranslation();
  const { language } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const isNew = !invoiceId;
  const { data: currencySettings } = useCurrencySettings(activeWorkspaceId);
  const { data: existingInvoice, isLoading } = useInvoiceDetail(activeWorkspaceId, invoiceId);
  const mutations = useInvoiceMutations();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [rateSuggestion, setRateSuggestion] = useState<{ rate: number; effectiveDate: string } | null>(null);

  useEffect(() => {
    if (isNew) {
      if (currencySettings && draft === null) {
        setDraft(emptyDraft(currencySettings.baseCurrency, currencySettings.defaultItbisRate));
      }
      return;
    }
    if (existingInvoice && draft === null) {
      setDraft({
        issueDate: existingInvoice.issueDate,
        dueDate: existingInvoice.dueDate ?? addDays(existingInvoice.issueDate, existingInvoice.paymentTermsDays),
        paymentTermsDays: existingInvoice.paymentTermsDays,
        clientNameSnapshot: existingInvoice.clientNameSnapshot,
        clientRncSnapshot: existingInvoice.clientRncSnapshot ?? "",
        productionCompanyNameSnapshot: existingInvoice.productionCompanyNameSnapshot ?? "",
        productionPurSnapshot: existingInvoice.productionPurSnapshot ?? "",
        workspaceSirecineSnapshot: existingInvoice.workspaceSirecineSnapshot ?? "",
        attentionName: existingInvoice.attentionName ?? "",
        attentionPhone: existingInvoice.attentionPhone ?? "",
        projectNameSnapshot: existingInvoice.projectNameSnapshot ?? "",
        productionName: existingInvoice.productionName ?? "",
        description: existingInvoice.description ?? "",
        packageTitle: existingInvoice.packageTitle ?? "",
        currency: existingInvoice.currency,
        baseCurrency: existingInvoice.baseCurrency,
        exchangeRate: existingInvoice.exchangeRate,
        exchangeRateSource: existingInvoice.exchangeRateSource,
        exchangeRateType: existingInvoice.exchangeRateType,
        exchangeRateEffectiveDate: existingInvoice.exchangeRateEffectiveDate ?? today(),
        taxProfile: existingInvoice.taxProfile,
        itbisRate: existingInvoice.itbisRate,
        taxAddedToTotal: existingInvoice.taxAddedToTotal,
        observations: existingInvoice.observations ?? "",
        items: existingInvoice.items.map((item) => ({
          sortOrder: item.sortOrder,
          quantity: item.quantity,
          title: item.title,
          description: item.description,
          durationValue: item.durationValue,
          durationUnit: item.durationUnit,
          unitPrice: item.unitPrice,
          discountRate: item.discountRate,
          discountAmount: item.discountAmount,
          taxBehavior: item.taxBehavior,
          taxRate: item.taxRate,
          notes: item.notes,
        })),
      });
    }
  }, [currencySettings, draft, existingInvoice, isNew]);

  useEffect(() => {
    if (!draft) return;
    if (draft.currency === draft.baseCurrency) {
      setRateSuggestion(null);
      return;
    }
    let cancelled = false;
    void fetchLatestRate(activeWorkspaceId, draft.currency, draft.baseCurrency).then((rate) => {
      if (cancelled || !rate || Math.abs(draft.exchangeRate - rate.rate) < 0.000001) {
        if (!cancelled) setRateSuggestion(null);
        return;
      }
      setRateSuggestion({ rate: rate.rate, effectiveDate: rate.effectiveDate });
    });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, draft?.baseCurrency, draft?.currency, draft?.exchangeRate]);

  const preview = useMemo(() => {
    if (!draft) return null;
    const input: CalculateQuotePreviewInput = {
      currency: draft.currency,
      baseCurrency: draft.baseCurrency,
      exchangeRate: draft.exchangeRate,
      taxProfile: draft.taxProfile,
      itbisRate: draft.itbisRate,
      taxAddedToTotal: draft.taxAddedToTotal,
      items: draft.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        durationValue: item.durationValue ?? null,
        discountRate: item.discountRate ?? null,
        discountAmount: item.discountAmount ?? null,
        taxBehavior: item.taxBehavior,
        taxRate: item.taxRate ?? null,
      })),
    };
    return calculateQuotePreview(input);
  }, [draft]);

  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const updateItem = (index: number, patch: Partial<InvoiceItemInput>) => {
    setDraft((current) => {
      if (!current) return current;
      const items = current.items.slice();
      items[index] = { ...items[index]!, ...patch };
      return { ...current, items };
    });
  };

  const addItem = () => {
    setDraft((current) => {
      if (!current) return current;
      const nextOrder = current.items.length ? Math.max(...current.items.map((item) => item.sortOrder)) + 1 : 1;
      return { ...current, items: [...current.items, emptyItem(nextOrder)] };
    });
  };

  const removeItem = (index: number) => {
    setDraft((current) => {
      if (!current || current.items.length <= 1) return current;
      return { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) };
    });
  };

  const handleIssueDateChange = (issueDate: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            issueDate,
            dueDate: current.paymentTermsDays ? addDays(issueDate, current.paymentTermsDays) : current.dueDate,
            exchangeRateEffectiveDate: current.exchangeRateEffectiveDate || issueDate,
          }
        : current,
    );
  };

  const handleTermsChange = (paymentTermsDays: number) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            paymentTermsDays,
            dueDate: addDays(current.issueDate, paymentTermsDays),
          }
        : current,
    );
  };

  const validate = () => {
    if (!draft) return false;
    if (!draft.clientNameSnapshot.trim()) {
      toast.error(t("finance.invoices.editor.validation.clientRequiredTitle"), t("finance.invoices.editor.validation.clientRequiredBody"));
      return false;
    }
    const firstInvalidIndex = draft.items.findIndex((item) => !item.title.trim() || item.quantity <= 0);
    if (firstInvalidIndex >= 0) {
      toast.error(
        t("finance.invoices.editor.validation.itemRequiredTitle"),
        t("finance.invoices.editor.validation.itemRequiredBody", { line: firstInvalidIndex + 1 }),
      );
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!draft || !validate()) return;
    setIsSaving(true);
    const headerPayload = {
      issueDate: draft.issueDate,
      dueDate: draft.dueDate || null,
      paymentTermsDays: draft.paymentTermsDays,
      clientId: null,
      clientNameSnapshot: draft.clientNameSnapshot.trim(),
      clientRncSnapshot: normalizeOptional(draft.clientRncSnapshot),
      productionCompanyId: null,
      productionCompanyNameSnapshot: normalizeOptional(draft.productionCompanyNameSnapshot),
      productionPurSnapshot: normalizeOptional(draft.productionPurSnapshot),
      workspaceSirecineSnapshot: normalizeOptional(draft.workspaceSirecineSnapshot),
      attentionName: normalizeOptional(draft.attentionName),
      attentionPhone: normalizeOptional(draft.attentionPhone),
      projectId: null,
      projectNameSnapshot: normalizeOptional(draft.projectNameSnapshot),
      productionName: normalizeOptional(draft.productionName),
      description: normalizeOptional(draft.description),
      packageTitle: normalizeOptional(draft.packageTitle),
      currency: draft.currency,
      baseCurrency: draft.baseCurrency,
      exchangeRate: draft.currency === draft.baseCurrency ? 1 : draft.exchangeRate,
      exchangeRateSource: draft.exchangeRateSource,
      exchangeRateType: draft.exchangeRateType,
      exchangeRateEffectiveDate: draft.exchangeRateEffectiveDate || null,
      taxProfile: draft.taxProfile,
      itbisRate: draft.itbisRate,
      taxAddedToTotal: draft.taxAddedToTotal,
      taxNotes: null,
      discountRate: null,
      discountAmount: null,
      observations: normalizeOptional(draft.observations),
      items: draft.items.map((item, index) => ({ ...item, sortOrder: index + 1, title: item.title.trim() })),
    };

    try {
      const result =
        isNew || !invoiceId
          ? await mutations.createInvoice({
              commandId: newCommandId("invoice-manual-create"),
              workspaceId: activeWorkspaceId,
              actorType: "user",
              sourceChannel: "desktop",
              sourceQuoteId: null,
              ...headerPayload,
            })
          : await mutations.updateInvoice({
              commandId: newCommandId("invoice-manual-update"),
              workspaceId: activeWorkspaceId,
              invoiceId,
              actorType: "user",
              sourceChannel: "desktop",
              ...headerPayload,
            });
      toast.success(
        isNew ? t("finance.invoices.editor.toasts.createdTitle") : t("finance.invoices.editor.toasts.updatedTitle"),
        result.summary,
      );
      navigate(`/finance/invoices/${result.invoiceId}`);
    } catch (err) {
      toast.error(
        t("finance.invoices.editor.toasts.saveFailed"),
        cleanIpcMessage(err, t("finance.invoices.toasts.tryAgain")),
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!isNew && existingInvoice && existingInvoice.status !== "draft") {
    return (
      <div className="page-stack">
        <button className="ghost-control" onClick={() => navigate(`/finance/invoices/${existingInvoice.id}`)} type="button">
          <ArrowLeft size={13} />
          <span>{t("finance.invoices.detail.back")}</span>
        </button>
        <GuidedEmptyState
          actionLabel={t("finance.invoices.editor.actions.openDetail")}
          body={t("finance.invoices.editor.lockedBody")}
          onAction={() => navigate(`/finance/invoices/${existingInvoice.id}`)}
          title={t("finance.invoices.editor.lockedTitle")}
        />
      </div>
    );
  }

  if (!draft || isLoading) {
    return (
      <div className="page-stack">
        <SectionHeader
          eyebrow={t("finance.title")}
          title={isNew ? t("finance.invoices.editor.newTitle") : t("finance.invoices.editor.editTitle")}
          body={t("finance.invoices.editor.loading")}
          titleTone="accent"
        />
      </div>
    );
  }

  return (
    <div className="page-stack invoice-editor-page">
      <div className="page-stack-row">
        <button className="ghost-control" onClick={() => navigate(isNew ? "/finance/invoices" : `/finance/invoices/${invoiceId}`)} type="button">
          <ArrowLeft size={13} />
          <span>{t("finance.invoices.detail.back")}</span>
        </button>
        <button className="ghost-control is-active" disabled={isSaving} onClick={() => void handleSave()} type="button">
          <Save size={13} />
          <span>{isSaving ? t("finance.invoices.editor.actions.saving") : t("finance.invoices.editor.actions.saveDraft")}</span>
        </button>
      </div>

      <SectionHeader
        eyebrow={t("finance.title")}
        title={isNew ? t("finance.invoices.editor.newTitle") : t("finance.invoices.editor.editTitle")}
        body={t("finance.invoices.editor.body")}
        titleTone="accent"
      />

      <div className="asset-workbench-layout" style={{ alignItems: "start" }}>
        <div className="page-stack">
          <SurfaceCard title={t("finance.invoices.editor.sections.clientProduction")}>
            <div className="agent-form-grid finance-editor-form">
              <label className="field-block">
                <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.clientName")}</RequiredLabel></span>
                <input
                  aria-required="true"
                  className="field-input"
                  onChange={(event) => updateDraft("clientNameSnapshot", event.target.value)}
                  value={draft.clientNameSnapshot}
                />
              </label>
              <label className="field-block">
                <span className="field-label">{t("finance.invoices.editor.fields.clientRnc")}</span>
                <input className="field-input" onChange={(event) => updateDraft("clientRncSnapshot", event.target.value)} value={draft.clientRncSnapshot} />
              </label>
              <label className="field-block">
                <span className="field-label">{t("finance.invoices.editor.fields.productionCompany")}</span>
                <input className="field-input" onChange={(event) => updateDraft("productionCompanyNameSnapshot", event.target.value)} value={draft.productionCompanyNameSnapshot} />
              </label>
              <label className="field-block">
                <span className="field-label">{t("finance.invoices.editor.fields.pur")}</span>
                <input className="field-input" onChange={(event) => updateDraft("productionPurSnapshot", event.target.value)} value={draft.productionPurSnapshot} />
              </label>
              <label className="field-block">
                <span className="field-label">{t("finance.invoices.editor.fields.projectProduction")}</span>
                <input className="field-input" onChange={(event) => updateDraft("projectNameSnapshot", event.target.value)} value={draft.projectNameSnapshot} />
              </label>
              <label className="field-block">
                <span className="field-label">{t("finance.invoices.editor.fields.packageTitle")}</span>
                <input className="field-input" onChange={(event) => updateDraft("packageTitle", event.target.value)} value={draft.packageTitle} />
              </label>
              <label className="field-block field-block-span-2">
                <span className="field-label">{t("finance.invoices.editor.fields.description")}</span>
                <textarea className="field-input" onChange={(event) => updateDraft("description", event.target.value)} rows={2} value={draft.description} />
              </label>
            </div>
          </SurfaceCard>

          <SurfaceCard title={t("finance.invoices.editor.sections.money")}>
            <div className="agent-form-grid finance-editor-form">
              <label className="field-block">
                <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.issueDate")}</RequiredLabel></span>
                <input aria-required="true" className="field-input" onChange={(event) => handleIssueDateChange(event.target.value)} type="date" value={draft.issueDate} />
              </label>
              <label className="field-block">
                <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.paymentTerms")}</RequiredLabel></span>
                <NumberStepper ariaLabel={t("finance.invoices.editor.aria.paymentTerms")} min={0} max={365} onChange={handleTermsChange} value={draft.paymentTermsDays} />
              </label>
              <label className="field-block">
                <span className="field-label">{t("finance.invoices.editor.fields.dueDate")}</span>
                <input
                  className="field-input"
                  min={draft.issueDate || undefined}
                  onChange={(event) => updateDraft("dueDate", event.target.value)}
                  type="date"
                  value={draft.dueDate}
                />
              </label>
              <label className="field-block">
                <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.currency")}</RequiredLabel></span>
                <select aria-required="true" className="field-input" onChange={(event) => updateDraft("currency", event.target.value)} value={draft.currency}>
                  {(currencySettings?.enabledCurrencies ?? ["DOP", "USD", "EUR"]).map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </label>
              <label className="field-block">
                <span className="field-label">
                  <RequiredLabel>{t("finance.invoices.editor.fields.exchangeRate", { from: draft.currency, to: draft.baseCurrency })}</RequiredLabel>
                </span>
                <NumberStepper
                  align="left"
                  ariaLabel={t("finance.invoices.editor.aria.exchangeRate")}
                  disabled={draft.currency === draft.baseCurrency}
                  min={0}
                  onChange={(next) => updateDraft("exchangeRate", next || 1)}
                  precision={4}
                  step={0.5}
                  value={draft.currency === draft.baseCurrency ? 1 : draft.exchangeRate}
                />
                {rateSuggestion && draft.currency !== draft.baseCurrency ? (
                  <button
                    className="rate-suggest-pill"
                    onClick={() => {
                      updateDraft("exchangeRate", rateSuggestion.rate);
                      updateDraft("exchangeRateEffectiveDate", rateSuggestion.effectiveDate);
                      setRateSuggestion(null);
                    }}
                    type="button"
                  >
                    {t("finance.invoices.editor.actions.useLatestRate", { rate: rateSuggestion.rate, date: rateSuggestion.effectiveDate })}
                  </button>
                ) : null}
              </label>
              <label className="field-block">
                <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.taxProfile")}</RequiredLabel></span>
                <select aria-required="true" className="field-input" onChange={(event) => updateDraft("taxProfile", event.target.value as QuoteTaxProfile)} value={draft.taxProfile}>
                  {taxProfileOptions.map((profile) => (
                    <option key={profile} value={profile}>
                      {t(`finance.quotes.editor.taxProfiles.${profile}`, { defaultValue: taxProfileLabel(profile) })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-block">
                <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.itbisRate")}</RequiredLabel></span>
                <NumberStepper ariaLabel={t("finance.invoices.editor.aria.itbisRate")} max={100} min={0} onChange={(next) => updateDraft("itbisRate", next / 100)} precision={2} step={0.5} suffix="%" value={Number((draft.itbisRate * 100).toFixed(2))} />
              </label>
              <label className="field-block">
                <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.addItbis")}</RequiredLabel></span>
                <select aria-required="true" className="field-input" onChange={(event) => updateDraft("taxAddedToTotal", event.target.value === "yes")} value={draft.taxAddedToTotal ? "yes" : "no"}>
                  <option value="yes">{t("finance.quotes.editor.itbisOptions.yes")}</option>
                  <option value="no">{t("finance.quotes.editor.itbisOptions.no")}</option>
                </select>
              </label>
            </div>
          </SurfaceCard>

          <SurfaceCard title={t("finance.invoices.editor.sections.items")}>
            <div className="invoice-editor-items">
              {draft.items.map((item, index) => {
                const breakdown = preview?.itemBreakdowns[index];
                return (
                  <div className="invoice-editor-item" key={index}>
                    <div className="invoice-editor-item-main">
                      <label className="field-block">
                        <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.itemTitle")}</RequiredLabel></span>
                        <input aria-required="true" className="field-input" onChange={(event) => updateItem(index, { title: event.target.value })} value={item.title} />
                      </label>
                      <label className="field-block">
                        <span className="field-label">{t("finance.invoices.editor.fields.itemDescription")}</span>
                        <input className="field-input" onChange={(event) => updateItem(index, { description: event.target.value || null })} value={item.description ?? ""} />
                      </label>
                    </div>
                    <div className="invoice-editor-item-controls finance-editor-form">
                      <label className="field-block">
                        <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.quantity")}</RequiredLabel></span>
                        <NumberStepper ariaLabel={t("finance.invoices.editor.aria.quantity", { line: index + 1 })} min={0} onChange={(next) => updateItem(index, { quantity: next })} precision={2} value={item.quantity} />
                      </label>
                      <label className="field-block">
                        <span className="field-label"><RequiredLabel>{t("finance.invoices.editor.fields.unitPrice")}</RequiredLabel></span>
                        <NumberStepper ariaLabel={t("finance.invoices.editor.aria.unitPrice", { line: index + 1 })} min={0} onChange={(next) => updateItem(index, { unitPrice: next })} precision={2} step={500} value={item.unitPrice} />
                      </label>
                      <label className="field-block">
                        <span className="field-label">{t("finance.invoices.editor.fields.taxBehavior")}</span>
                        <select className="field-input" onChange={(event) => updateItem(index, { taxBehavior: event.target.value as QuoteItemTaxBehavior })} value={item.taxBehavior}>
                          {taxBehaviorOptions.map((behavior) => (
                            <option key={behavior} value={behavior}>{t(`finance.quotes.editor.taxBehaviors.${behavior}`, { defaultValue: behavior })}</option>
                          ))}
                        </select>
                      </label>
                      <div className="invoice-editor-item-total">
                        <span>{t("finance.invoices.editor.fields.lineTotal")}</span>
                        <strong>{formatCurrency(breakdown?.lineTotal ?? 0, draft.currency, language)}</strong>
                      </div>
                      <button className="icon-ghost-control is-danger" disabled={draft.items.length <= 1} onClick={() => removeItem(index)} title={t("finance.invoices.editor.actions.removeLine")} type="button">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="ghost-control" onClick={addItem} type="button">
              <Plus size={13} />
              <span>{t("finance.invoices.editor.actions.addLine")}</span>
            </button>
          </SurfaceCard>
        </div>

        <aside className="page-stack">
          <SurfaceCard title={t("finance.invoices.editor.sections.totals")}>
            <div className="settings-mini-list">
              <div className="settings-mini-row"><span>{t("finance.invoices.detail.totals.subtotal")}</span><strong>{formatCurrency(preview?.subtotal ?? 0, draft.currency, language)}</strong></div>
              <div className="settings-mini-row"><span>{t("finance.invoices.detail.totals.tax")}</span><strong>{formatCurrency(preview?.taxAmount ?? 0, draft.currency, language)}</strong></div>
              <div className="settings-mini-row"><span>{t("finance.invoices.detail.totals.total")}</span><strong>{formatCurrency(preview?.total ?? 0, draft.currency, language)}</strong></div>
              {draft.currency !== draft.baseCurrency ? (
                <div className="settings-mini-row"><span>{draft.baseCurrency}</span><strong>{formatCurrency(preview?.baseCurrencyTotal ?? 0, draft.baseCurrency, language)}</strong></div>
              ) : null}
            </div>
          </SurfaceCard>
          <SurfaceCard title={t("finance.invoices.editor.sections.notes")}>
            <label className="field-block">
              <span className="field-label">{t("finance.invoices.editor.fields.observations")}</span>
              <textarea className="field-input" onChange={(event) => updateDraft("observations", event.target.value)} rows={5} value={draft.observations} />
            </label>
          </SurfaceCard>
        </aside>
      </div>
    </div>
  );
};

export default InvoiceEditorPage;
