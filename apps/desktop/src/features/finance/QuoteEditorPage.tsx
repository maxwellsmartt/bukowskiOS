import { ArrowLeft, Clock, Download, GripVertical, History, Plus, ReceiptText, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type {
  CurrencyRateSource,
  CurrencyRateType,
  QuoteItemDurationUnit,
  QuoteItemInput,
  QuoteItemTaxBehavior,
  QuoteTaxProfile,
} from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { CompactSelect } from "@shared/components/CompactSelect";
import { HelpHint } from "@shared/components/HelpHint";
import { NumberStepper } from "@shared/components/NumberStepper";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";
import { useRecentValues } from "@shared/hooks/useRecentValues";

import {
  calculateQuotePreview,
  type CalculateQuotePreviewInput,
} from "./quoteCalculationPreview";
import {
  formatCurrency,
  newCommandId,
  statusLabel,
  statusTone,
  taxProfileLabel,
} from "./quoteHelpers";
import { quoteTemplates, type QuoteTemplate } from "./quoteTemplates";
import { QuoteVersionPanel } from "./QuoteVersionPanel";
import { fetchLatestRate, useCurrencySettings } from "./useCurrencyData";
import { useInvoiceMutations } from "./useInvoiceData";
import { useQuoteDetail, useQuoteMutations, useQuoteVersions } from "./useQuoteData";
import { useCatalogData } from "@features/projects/useProjectsData";

type Draft = {
  quoteDate: string;
  validityDays: number;
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
  items: QuoteItemInput[];
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyItem = (sortOrder: number): QuoteItemInput => ({
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

const emptyDraft = (baseCurrency: string, itbisRate: number): Draft => ({
  quoteDate: today(),
  validityDays: 30,
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
  exchangeRateEffectiveDate: today(),
  taxProfile: "standard_itbis",
  itbisRate,
  taxAddedToTotal: true,
  observations: "",
  items: [emptyItem(1)],
});

const taxBehaviorOptions: QuoteItemTaxBehavior[] = ["follows_quote", "taxable", "exempt", "show_only", "included"];

const taxProfileOptions: QuoteTaxProfile[] = ["standard_itbis", "film_law_exempt", "mixed", "manual"];

// Order matters: the "flat" option sits first because picking it hides
// the duration value (the cell acts as a flat-rate item × quantity).
const durationUnitOptions: QuoteItemDurationUnit[] = ["flat", "day", "week", "month", "unit"];

/** A "duration unit" is meaningful only when it implies a multiplier. */
const isCountableDurationUnit = (unit: QuoteItemDurationUnit | null | undefined) =>
  unit !== null && unit !== undefined && unit !== "flat";

export const QuoteEditorPage = () => {
  const { t } = useTranslation();
  const { quoteId } = useParams<{ quoteId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNew = !quoteId || quoteId === "new";
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const { language } = useLocale();
  const { data: currencySettings } = useCurrencySettings(activeWorkspaceId);
  const { data: existingQuote, isLoading: isLoadingQuote, refresh } = useQuoteDetail(
    activeWorkspaceId,
    isNew ? null : quoteId,
  );
  const { data: versions, refresh: refreshVersions } = useQuoteVersions(
    activeWorkspaceId,
    isNew ? null : quoteId,
  );
  const { data: catalog } = useCatalogData();
  const mutations = useQuoteMutations();
  const invoiceMutations = useInvoiceMutations();
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  // Deep-link: `/finance/quotes/:id?version=N` auto-opens the versions
  // card and pre-selects that version once they finish loading. We only
  // honour it once per param value so flipping versions inside the editor
  // does not get clobbered by the URL.
  const consumedVersionParamRef = useRef<string | null>(null);
  const [rateSuggestion, setRateSuggestion] = useState<{ rate: number; effectiveDate: string } | null>(null);
  const [activeItemSuggestion, setActiveItemSuggestion] = useState<{
    field: "title" | "description";
    index: number;
  } | null>(null);

  // Per-workspace recall of previously used values for fast re-entry.
  const recentClients = useRecentValues(`${activeWorkspaceId}:quote-client`);
  const recentRncs = useRecentValues(`${activeWorkspaceId}:quote-client-rnc`);
  const recentProductions = useRecentValues(`${activeWorkspaceId}:quote-production-co`);
  const recentPurs = useRecentValues(`${activeWorkspaceId}:quote-pur`);
  const recentSirecines = useRecentValues(`${activeWorkspaceId}:quote-sirecine`);
  const recentAttention = useRecentValues(`${activeWorkspaceId}:quote-attention`);
  const recentPhones = useRecentValues(`${activeWorkspaceId}:quote-phone`);
  const recentProjects = useRecentValues(`${activeWorkspaceId}:quote-project`);
  const recentPackages = useRecentValues(`${activeWorkspaceId}:quote-package`);
  const recentItemTitles = useRecentValues(`${activeWorkspaceId}:quote-item-title`, { limit: 30 });
  const recentItemDescriptions = useRecentValues(
    `${activeWorkspaceId}:quote-item-description`,
    { limit: 30 },
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Honour the `?version=N` deep-link once versions have loaded. Drop the
  // param after we apply it so the URL stays clean and re-opening the same
  // version manually doesn't re-trigger this effect.
  useEffect(() => {
    const raw = searchParams.get("version");
    if (!raw || raw === consumedVersionParamRef.current) return;
    if (!versions.length) return;

    const target = versions.find((v) => String(v.versionNumber) === raw);
    if (!target) return;

    setIsVersionsOpen(true);
    setSelectedVersionId(target.id);
    consumedVersionParamRef.current = raw;

    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("version");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, versions, setSearchParams]);

  // Hydrate draft when settings or existing quote change.
  useEffect(() => {
    if (isNew) {
      if (currencySettings && draft === null) {
        setDraft(emptyDraft(currencySettings.baseCurrency, currencySettings.defaultItbisRate));
      }
      return;
    }
    if (existingQuote && draft === null) {
      setDraft({
        quoteDate: existingQuote.quoteDate,
        validityDays: existingQuote.validityDays,
        clientNameSnapshot: existingQuote.clientNameSnapshot,
        clientRncSnapshot: existingQuote.clientRncSnapshot ?? "",
        productionCompanyNameSnapshot: existingQuote.productionCompanyNameSnapshot ?? "",
        productionPurSnapshot: existingQuote.productionPurSnapshot ?? "",
        workspaceSirecineSnapshot: existingQuote.workspaceSirecineSnapshot ?? "",
        attentionName: existingQuote.attentionName ?? "",
        attentionPhone: existingQuote.attentionPhone ?? "",
        projectNameSnapshot: existingQuote.projectNameSnapshot ?? "",
        productionName: existingQuote.productionName ?? "",
        description: existingQuote.description ?? "",
        packageTitle: existingQuote.packageTitle ?? "",
        currency: existingQuote.currency,
        baseCurrency: existingQuote.baseCurrency,
        exchangeRate: existingQuote.exchangeRate,
        exchangeRateSource: existingQuote.exchangeRateSource,
        exchangeRateType: existingQuote.exchangeRateType,
        exchangeRateEffectiveDate: existingQuote.exchangeRateEffectiveDate ?? today(),
        taxProfile: existingQuote.taxProfile,
        itbisRate: existingQuote.itbisRate,
        taxAddedToTotal: existingQuote.taxAddedToTotal,
        observations: existingQuote.observations ?? "",
        items: existingQuote.items.map((item) => ({
          sortOrder: item.sortOrder,
          quantity: item.quantity,
          title: item.title,
          description: item.description,
          durationValue: item.durationValue,
          durationUnit: item.durationUnit,
          unitPrice: item.unitPrice,
          discountRate: item.discountRate,
          discountAmount: null,
          taxBehavior: item.taxBehavior,
          taxRate: item.taxRate,
          notes: item.notes,
        })),
      });
    }
  }, [isNew, currencySettings, existingQuote, draft]);

  // Drag-and-drop reorder state — declared BEFORE any early return to keep the
  // hook order stable across renders (React enforces this).
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const quoteStatusLabel = (status: Parameters<typeof statusLabel>[0]) =>
    t(`finance.quotes.status.${status}`, { defaultValue: statusLabel(status) });
  const taxProfileDisplay = (profile: QuoteTaxProfile) =>
    t(`finance.quotes.editor.taxProfiles.${profile}`, { defaultValue: taxProfileLabel(profile) });
  const taxBehaviorLabel = (behavior: QuoteItemTaxBehavior) =>
    t(`finance.quotes.editor.taxBehaviors.${behavior}`, { defaultValue: behavior });
  const durationUnitLabel = (unit: QuoteItemDurationUnit) =>
    t(`finance.quotes.editor.durationUnits.${unit}`, { defaultValue: unit });

  // Whenever the quote currency changes (and isn't equal to base), look up the
  // most recent exchange rate so we can offer a one-click "use this rate" pill.
  useEffect(() => {
    if (!draft) return;
    if (draft.currency === draft.baseCurrency) {
      setRateSuggestion(null);
      return;
    }
    let cancelled = false;
    void fetchLatestRate(activeWorkspaceId, draft.currency, draft.baseCurrency).then((rate) => {
      if (cancelled || !rate) {
        if (!cancelled) setRateSuggestion(null);
        return;
      }
      // Don't suggest if the editor already has the same rate.
      if (Math.abs(draft.exchangeRate - rate.rate) < 0.000001) {
        setRateSuggestion(null);
        return;
      }
      setRateSuggestion({ rate: rate.rate, effectiveDate: rate.effectiveDate });
    });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, draft?.currency, draft?.baseCurrency, draft?.exchangeRate]);

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

  if (!draft) {
    return (
      <div className="page-stack">
        <SectionHeader
          eyebrow={t("finance.title")}
          title={isNew ? t("finance.quotes.newQuote") : t("finance.quotes.editor.quote")}
          body={isLoadingQuote ? t("finance.quotes.editor.loadingQuote") : t("finance.quotes.editor.preparingDraft")}
          titleTone="accent"
        />
      </div>
    );
  }

  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateItem = (index: number, patch: Partial<QuoteItemInput>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const items = prev.items.slice();
      items[index] = { ...items[index]!, ...patch };
      return { ...prev, items };
    });
  };

  const getItemSuggestions = (field: "title" | "description", value: string) => {
    const source = field === "title" ? recentItemTitles.values : recentItemDescriptions.values;
    const query = value.trim().toLowerCase();
    return source
      .filter((candidate) => {
        const normalized = candidate.trim().toLowerCase();
        if (!normalized || normalized === query) return false;
        return query.length === 0 || normalized.includes(query);
      })
      .slice(0, 6);
  };

  const applyItemSuggestion = (
    index: number,
    field: "title" | "description",
    value: string,
  ) => {
    updateItem(index, field === "title" ? { title: value } : { description: value });
    setActiveItemSuggestion(null);
  };

  const addItem = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextOrder = prev.items.length === 0 ? 1 : Math.max(...prev.items.map((it) => it.sortOrder)) + 1;
      return { ...prev, items: [...prev.items, emptyItem(nextOrder)] };
    });
  };

  const applyTemplate = (template: QuoteTemplate) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        packageTitle: template.packageTitle || prev.packageTitle,
        taxProfile: template.taxProfile,
        taxAddedToTotal: template.taxAddedToTotal,
        items: template.items.map((item, index) => ({ ...item, sortOrder: index + 1 })),
      };
    });
    toast.success(
      t("finance.quotes.editor.toasts.templateLoaded", { template: template.label }),
      t("finance.quotes.editor.toasts.templateLoadedBody"),
    );
  };

  const removeItem = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.items.length === 1) return prev;
      return { ...prev, items: prev.items.filter((_, i) => i !== index) };
    });
  };

  const handleDragStart = (index: number) => (event: DragEvent<HTMLElement>) => {
    setDraggingIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    if (draggingIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (targetIndex: number) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const source = draggingIndex;
    setDraggingIndex(null);
    setDragOverIndex(null);
    if (source === null || source === targetIndex) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = prev.items.slice();
      const [moved] = next.splice(source, 1);
      if (!moved) return prev;
      next.splice(targetIndex, 0, moved);
      // Renumber sortOrder to match the new visual order.
      return {
        ...prev,
        items: next.map((item, idx) => ({ ...item, sortOrder: idx + 1 })),
      };
    });
  };

  const rememberDraftValues = () => {
    if (!draft) return;
    recentClients.remember(draft.clientNameSnapshot);
    recentRncs.remember(draft.clientRncSnapshot);
    recentProductions.remember(draft.productionCompanyNameSnapshot);
    recentPurs.remember(draft.productionPurSnapshot);
    recentSirecines.remember(draft.workspaceSirecineSnapshot);
    recentAttention.remember(draft.attentionName);
    recentPhones.remember(draft.attentionPhone);
    recentProjects.remember(draft.projectNameSnapshot);
    recentPackages.remember(draft.packageTitle);
    draft.items.forEach((item) => {
      recentItemTitles.remember(item.title);
      recentItemDescriptions.remember(item.description ?? "");
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.clientNameSnapshot.trim()) {
      toast.error(
        t("finance.quotes.editor.validation.clientRequiredTitle"),
        t("finance.quotes.editor.validation.clientRequiredBody"),
      );
      return;
    }
    if (draft.items.some((item) => !item.title.trim())) {
      toast.error(
        t("finance.quotes.editor.validation.itemTitleRequiredTitle"),
        t("finance.quotes.editor.validation.itemTitleRequiredBody"),
      );
      return;
    }

    setIsSaving(true);
    try {
      const headerPayload = {
        quoteDate: draft.quoteDate,
        validityDays: draft.validityDays,
        clientId: null,
        clientNameSnapshot: draft.clientNameSnapshot,
        clientRncSnapshot: draft.clientRncSnapshot.trim() || null,
        productionCompanyId: null,
        productionCompanyNameSnapshot: draft.productionCompanyNameSnapshot.trim() || null,
        productionPurSnapshot: draft.productionPurSnapshot.trim() || null,
        workspaceSirecineSnapshot: draft.workspaceSirecineSnapshot.trim() || null,
        attentionName: draft.attentionName.trim() || null,
        attentionPhone: draft.attentionPhone.trim() || null,
        projectId: null,
        projectNameSnapshot: draft.projectNameSnapshot.trim() || null,
        productionName: draft.productionName.trim() || null,
        description: draft.description.trim() || null,
        packageTitle: draft.packageTitle.trim() || null,
        currency: draft.currency,
        baseCurrency: draft.baseCurrency,
        exchangeRate: draft.exchangeRate,
        exchangeRateSource: draft.exchangeRateSource,
        exchangeRateType: draft.exchangeRateType,
        exchangeRateEffectiveDate: draft.exchangeRateEffectiveDate || null,
        taxProfile: draft.taxProfile,
        itbisRate: draft.itbisRate,
        taxAddedToTotal: draft.taxAddedToTotal,
        taxNotes: null,
        discountRate: null,
        discountAmount: null,
        observations: draft.observations.trim() || null,
      };

      if (isNew) {
        const result = await mutations.createQuote({
          commandId: newCommandId("quote-create"),
          workspaceId: activeWorkspaceId,
          actorType: "user",
          sourceChannel: "desktop",
          ...headerPayload,
          items: draft.items,
        });
        rememberDraftValues();
        toast.success(
          t("finance.quotes.editor.toasts.createdTitle", { number: result.quoteNumber }),
          t("finance.quotes.editor.toasts.createdBody"),
        );
        navigate(`/finance/quotes/${result.quoteId}`);
      } else if (quoteId) {
        await mutations.updateQuote({
          commandId: newCommandId("quote-update"),
          workspaceId: activeWorkspaceId,
          quoteId,
          actorType: "user",
          sourceChannel: "desktop",
          ...headerPayload,
          items: draft.items,
        });
        rememberDraftValues();
        toast.success(t("finance.quotes.editor.toasts.updatedTitle"), t("finance.quotes.editor.toasts.updatedBody"));
        refresh();
        refreshVersions();
      }
    } catch (err) {
      toast.error(
        t("finance.quotes.editor.toasts.saveFailed"),
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
          : t("finance.quotes.editor.toasts.checkConnection"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportPdf = async () => {
    if (!quoteId || !window.bukowskiQuotes) return;
    try {
      const result = await window.bukowskiQuotes.exportPdf(activeWorkspaceId, quoteId);
      if (result.saved) {
        toast.success(t("finance.quotes.toasts.pdfReady"), result.summary ?? t("finance.quotes.toasts.pdfSaved"));
      } else {
        toast.info(t("finance.quotes.toasts.exportCancelled"), t("finance.quotes.toasts.exportCancelledBody"));
      }
    } catch (err) {
      toast.error(
        t("finance.quotes.toasts.exportFailed"),
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
          : t("common.tryAgain"),
      );
    }
  };

  const handleRestoreVersion = async (versionNumber: number) => {
    if (!quoteId) return;
    setIsRestoringVersion(true);
    try {
      await mutations.restoreFromVersion({
        commandId: newCommandId(`quote-restore-v${versionNumber}`),
        workspaceId: activeWorkspaceId,
        quoteId,
        versionNumber,
        actorType: "user",
        sourceChannel: "desktop",
      });
      toast.success(
        t("finance.quotes.editor.versions.restoreSuccessTitle"),
        t("finance.quotes.editor.versions.restoreSuccessBody", { number: versionNumber }),
      );
      setSelectedVersionId(null);
      refresh();
      refreshVersions();
    } catch (err) {
      toast.error(
        t("finance.quotes.editor.versions.restoreFailureTitle"),
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
          : t("common.tryAgain"),
      );
    } finally {
      setIsRestoringVersion(false);
    }
  };

  const handleSetStatus = async (status: "sent" | "approved" | "rejected" | "cancelled") => {
    if (!quoteId) return;
    try {
      await mutations.setStatus({
        commandId: newCommandId(`quote-${status}`),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        quoteId,
        status,
        reason: status === "cancelled" ? "Cancelled from editor." : null,
      });
      toast.success(
        t("finance.quotes.editor.toasts.statusChangedTitle", { status: quoteStatusLabel(status) }),
        t("finance.quotes.editor.toasts.statusChangedBody"),
      );
      refresh();
    } catch (err) {
      toast.error(
        t("finance.quotes.editor.toasts.statusFailed"),
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
          : t("common.tryAgain"),
      );
    }
  };

  const handleGenerateInvoice = async () => {
    if (!quoteId || existingQuote?.status !== "approved") return;
    try {
      const result = await invoiceMutations.createFromQuote({
        commandId: newCommandId("inv"),
        workspaceId: activeWorkspaceId,
        quoteId,
      });
      toast.success(
        t("finance.quotes.toasts.invoiceCreatedTitle", { number: result.invoiceNumber }),
        result.summary,
      );
      navigate("/finance/invoices");
    } catch (err) {
      toast.error(
        t("finance.quotes.toasts.invoiceCreateFailed"),
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
          : t("common.tryAgain"),
      );
    }
  };

  return (
    <div className="page-stack">
      <div className="page-stack-row">
        <button className="ghost-control" onClick={() => navigate("/finance/quotes")} type="button">
          <ArrowLeft size={13} />
          <span>{t("finance.quotes.editor.allQuotes")}</span>
        </button>
        <div className="quote-editor-header-pills">
          {!isNew && versions.length > 0 ? (
            <button
              className="quote-editor-header-pill quote-editor-header-pill-button"
              aria-pressed={isVersionsOpen}
              onClick={() => setIsVersionsOpen((prev) => !prev)}
              type="button"
            >
              <History size={13} aria-hidden="true" />
              <span>{t("finance.quotes.editor.versionCount", { count: versions.length })}</span>
            </button>
          ) : null}
          {existingQuote ? (
            <span className={`quote-editor-header-pill quote-editor-header-pill-status status-tone-${statusTone(existingQuote.status)}`}>
              {quoteStatusLabel(existingQuote.status)}
            </span>
          ) : null}
        </div>
      </div>

      {isVersionsOpen && !isNew ? (
        <SurfaceCard
          subtitle={t("finance.quotes.editor.versionHistorySubtitle")}
          title={t("finance.quotes.editor.versionHistory")}
        >
          <div className="quote-versions-timeline">
            {versions.map((version) => {
              const total =
                typeof version.snapshot.total === "number"
                  ? formatCurrency(version.snapshot.total, String(version.snapshot.currency ?? draft.currency), language)
                  : "—";
              const isSelected = selectedVersionId === version.id;
              return (
                <button
                  type="button"
                  className={`quote-versions-row quote-versions-row-button${isSelected ? " is-selected" : ""}`}
                  key={version.id}
                  aria-pressed={isSelected}
                  aria-label={t("finance.quotes.editor.versions.openTooltip", { number: version.versionNumber })}
                  onClick={() =>
                    setSelectedVersionId((current) => (current === version.id ? null : version.id))
                  }
                >
                  <div className="quote-versions-marker">
                    <span className="quote-versions-dot" />
                    <span className="quote-versions-line" />
                  </div>
                  <div className="quote-versions-body">
                    <div className="quote-versions-head">
                      <span className="quote-versions-tag">v{version.versionNumber}</span>
                      <span className="quote-versions-timestamp">
                        <Clock size={12} aria-hidden="true" />
                        <span>{version.createdAt.slice(0, 16).replace("T", " ")}</span>
                      </span>
                      <span className="quote-versions-total">{total}</span>
                    </div>
                    {version.changeSummary ? (
                      <p className="quote-versions-summary">{version.changeSummary}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </SurfaceCard>
      ) : null}

      {isVersionsOpen && !isNew && selectedVersionId ? (() => {
        const selected = versions.find((v) => v.id === selectedVersionId);
        if (!selected) return null;
        return (
          <QuoteVersionPanel
            version={selected}
            currentQuote={existingQuote}
            canRestore={Boolean(existingQuote) && existingQuote?.status === "draft"}
            isRestoring={isRestoringVersion}
            onClose={() => setSelectedVersionId(null)}
            onRestore={() => handleRestoreVersion(selected.versionNumber)}
          />
        );
      })() : null}

      <SectionHeader
        eyebrow={isNew ? t("finance.quotes.editor.newEyebrow") : t("finance.quotes.editor.quoteEyebrow", { number: existingQuote?.quoteNumber ?? "" })}
        title={isNew ? t("finance.quotes.newQuote") : t("finance.quotes.editor.quoteNumber", { number: existingQuote?.quoteNumber ?? "" })}
        body={
          isNew
            ? t("finance.quotes.editor.headerBodyNew")
            : t("finance.quotes.editor.headerBodyExisting", {
                created: existingQuote?.createdAt?.slice(0, 10),
                updated: existingQuote?.updatedAt?.slice(0, 10),
              })
        }
        titleTone="accent"
      />

      {isNew ? (
        <SurfaceCard title={t("finance.quotes.editor.quickStart")} subtitle={t("finance.quotes.editor.quickStartSubtitle")}>
          <div className="filter-pill-row">
            {quoteTemplates.map((template) => (
              <button
                className="filter-pill"
                key={template.key}
                onClick={() => applyTemplate(template)}
                title={template.description}
                type="button"
              >
                {template.label}
              </button>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard title={t("finance.quotes.editor.clientProduction")}>
        <div className="agent-form-grid">
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.clientName")}</span>
            <input
              className="field-input"
              list="quote-catalog-clients"
              onChange={(e) => {
                const value = e.target.value;
                updateDraft("clientNameSnapshot", value);
                // If the value matches a catalog client exactly, pre-fill RNC
                // — saves the user from re-typing it.
                const match = catalog.clients.find(
                  (client) => client.name.toLowerCase() === value.trim().toLowerCase(),
                );
                if (match?.rnc && !draft.clientRncSnapshot) {
                  updateDraft("clientRncSnapshot", match.rnc);
                }
              }}
              value={draft.clientNameSnapshot}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.clientRnc")}</span>
            <input
              className="field-input"
              list="quote-recent-rncs"
              onChange={(e) => updateDraft("clientRncSnapshot", e.target.value)}
              placeholder="1-30-12345-6"
              value={draft.clientRncSnapshot}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.productionCompany")}</span>
            <input
              className="field-input"
              list="quote-catalog-productions"
              onChange={(e) => {
                const value = e.target.value;
                updateDraft("productionCompanyNameSnapshot", value);
                const match = catalog.productionCompanies.find(
                  (company) => company.name.toLowerCase() === value.trim().toLowerCase(),
                );
                if (match?.pur && !draft.productionPurSnapshot) {
                  updateDraft("productionPurSnapshot", match.pur);
                }
              }}
              value={draft.productionCompanyNameSnapshot}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.pur")}</span>
            <input
              className="field-input"
              list="quote-recent-purs"
              onChange={(e) => updateDraft("productionPurSnapshot", e.target.value)}
              value={draft.productionPurSnapshot}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.sirecine")}</span>
            <input
              className="field-input"
              list="quote-recent-sirecines"
              onChange={(e) => updateDraft("workspaceSirecineSnapshot", e.target.value)}
              value={draft.workspaceSirecineSnapshot}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.attentionTo")}</span>
            <input
              className="field-input"
              list="quote-recent-attention"
              onChange={(e) => updateDraft("attentionName", e.target.value)}
              value={draft.attentionName}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.phone")}</span>
            <input
              className="field-input"
              list="quote-recent-phones"
              onChange={(e) => updateDraft("attentionPhone", e.target.value)}
              value={draft.attentionPhone}
            />
          </label>
          <label className="field-block field-block-span-2">
            <span className="field-label">{t("finance.quotes.editor.fields.projectProduction")}</span>
            <input
              className="field-input"
              list="quote-recent-projects"
              onChange={(e) => updateDraft("projectNameSnapshot", e.target.value)}
              placeholder={t("finance.quotes.editor.placeholders.project")}
              value={draft.projectNameSnapshot}
            />
          </label>
          <label className="field-block field-block-span-2">
            <span className="field-label">{t("finance.quotes.editor.fields.packageTitle")}</span>
            <input
              className="field-input"
              list="quote-recent-packages"
              onChange={(e) => updateDraft("packageTitle", e.target.value)}
              placeholder={t("finance.quotes.editor.placeholders.package")}
              value={draft.packageTitle}
            />
          </label>

          {/* Datalists — native autocomplete from previously typed values. */}
          <datalist id="quote-recent-clients">
            {recentClients.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="quote-recent-rncs">
            {recentRncs.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="quote-recent-productions">
            {recentProductions.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="quote-recent-purs">
            {recentPurs.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="quote-recent-sirecines">
            {recentSirecines.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="quote-recent-attention">
            {recentAttention.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="quote-recent-phones">
            {recentPhones.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="quote-recent-projects">
            {recentProjects.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="quote-recent-packages">
            {recentPackages.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>

          {/* Catalog-backed datalists: surface clients and production companies
              the user has already saved in the catalog so picking one prefills
              RNC / PUR automatically. */}
          <datalist id="quote-catalog-clients">
            {catalog.clients.map((client) => (
              <option key={client.id} value={client.name}>
                {client.rnc ? `RNC ${client.rnc}` : client.contactName}
              </option>
            ))}
            {recentClients.values
              .filter((value) => !catalog.clients.some((client) => client.name === value))
              .map((value) => (
                <option key={`recent-${value}`} value={value} />
              ))}
          </datalist>
          <datalist id="quote-catalog-productions">
            {catalog.productionCompanies.map((company) => (
              <option key={company.id} value={company.name}>
                {company.pur ? `PUR ${company.pur}` : company.contactName}
              </option>
            ))}
            {recentProductions.values
              .filter((value) => !catalog.productionCompanies.some((c) => c.name === value))
              .map((value) => (
                <option key={`recent-${value}`} value={value} />
              ))}
          </datalist>
          <label className="field-block field-block-span-2">
            <span className="field-label">{t("finance.quotes.editor.fields.description")}</span>
            <textarea
              className="field-input"
              onChange={(e) => updateDraft("description", e.target.value)}
              placeholder={t("finance.quotes.editor.placeholders.description")}
              rows={2}
              value={draft.description}
            />
          </label>
        </div>
      </SurfaceCard>

      <SurfaceCard title={t("finance.quotes.editor.currencyTax")}>
        <div className="agent-form-grid">
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.quoteDate")}</span>
            <input
              className="field-input"
              onChange={(e) => updateDraft("quoteDate", e.target.value)}
              type="date"
              value={draft.quoteDate}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.validityDays")}</span>
            <NumberStepper
              align="left"
              ariaLabel={t("finance.quotes.editor.aria.validityDays")}
              max={365}
              min={1}
              onChange={(next) => updateDraft("validityDays", next)}
              value={draft.validityDays}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.currency")}</span>
            <select
              className="field-input"
              onChange={(e) => updateDraft("currency", e.target.value)}
              value={draft.currency}
            >
              {(currencySettings?.enabledCurrencies ?? ["DOP", "USD", "EUR"]).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="field-label">
              {t("finance.quotes.editor.fields.exchangeRate", { from: draft.currency, to: draft.baseCurrency })}
            </span>
            <NumberStepper
              align="left"
              ariaLabel={t("finance.quotes.editor.aria.exchangeRate")}
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
                title={t("finance.quotes.editor.actions.useLatestRateTitle", { date: rateSuggestion.effectiveDate })}
                type="button"
              >
                {t("finance.quotes.editor.actions.useLatestRate", {
                  rate: rateSuggestion.rate,
                  date: rateSuggestion.effectiveDate,
                })}
              </button>
            ) : null}
          </label>
          <label className="field-block field-block-span-2">
            <span className="field-label">{t("finance.quotes.editor.fields.taxProfile")}</span>
            <select
              className="field-input"
              onChange={(event) => updateDraft("taxProfile", event.target.value as typeof draft.taxProfile)}
              value={draft.taxProfile}
            >
              {taxProfileOptions.map((profile) => (
                <option key={profile} value={profile}>
                  {taxProfileDisplay(profile)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.itbisRate")}</span>
            <NumberStepper
              align="left"
              ariaLabel={t("finance.quotes.editor.aria.itbisRate")}
              max={100}
              min={0}
              onChange={(next) => updateDraft("itbisRate", next / 100)}
              precision={2}
              step={0.5}
              suffix="%"
              value={Number((draft.itbisRate * 100).toFixed(2))}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("finance.quotes.editor.fields.addItbis")}</span>
            <select
              className="field-input"
              onChange={(e) => updateDraft("taxAddedToTotal", e.target.value === "yes")}
              value={draft.taxAddedToTotal ? "yes" : "no"}
            >
              <option value="yes">{t("finance.quotes.editor.itbisOptions.yes")}</option>
              <option value="no">{t("finance.quotes.editor.itbisOptions.no")}</option>
            </select>
          </label>
        </div>
      </SurfaceCard>

      <SurfaceCard
        title={t("finance.quotes.editor.lineItems")}
        subtitle={t("finance.quotes.editor.lineItemsSubtitle")}
      >
        <div className="quote-items-grid">
          <div className="quote-items-header">
            <span aria-hidden="true" />
            <span>{t("finance.quotes.editor.itemColumns.description")}</span>
            <span>{t("finance.quotes.editor.itemColumns.qty")}</span>
            <span>{t("finance.quotes.editor.itemColumns.unitPrice")}</span>
            <span className="quote-items-header-duration">
              {t("finance.quotes.editor.itemColumns.duration")}
              <HelpHint
                body={t("finance.quotes.editor.help.duration")}
                label={t("finance.quotes.editor.help.durationLabel")}
              />
            </span>
            <span className="quote-items-header-tax">
              {t("finance.quotes.editor.itemColumns.tax")}
              <HelpHint
                body={t("finance.quotes.editor.help.taxBehavior")}
                label={t("finance.quotes.editor.help.taxBehaviorLabel")}
              />
            </span>
            <span>{t("finance.quotes.editor.itemColumns.total")}</span>
            <span aria-hidden="true" />
          </div>
          {draft.items.map((item, index) => {
            const breakdown = preview?.itemBreakdowns[index];
            const isDragging = draggingIndex === index;
            const isDropTarget = dragOverIndex === index && draggingIndex !== null && draggingIndex !== index;
            return (
              <div
                className={`quote-items-row${isDragging ? " is-dragging" : ""}${
                  isDropTarget ? " is-drop-target" : ""
                }`}
                key={index}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver(index)}
                onDrop={handleDrop(index)}
              >
                <button
                  aria-label={t("finance.quotes.editor.aria.dragLine", { line: index + 1 })}
                  className="quote-items-drag"
                  draggable
                  onDragStart={handleDragStart(index)}
                  title={t("finance.quotes.editor.actions.dragToReorder")}
                  type="button"
                >
                  <GripVertical size={14} />
                </button>
                <div className="quote-items-description">
                  <div className="quote-item-autocomplete">
                    <input
                      className="field-input quote-items-description-title"
                      onBlur={() => window.setTimeout(() => setActiveItemSuggestion(null), 120)}
                      onChange={(e) => {
                        setActiveItemSuggestion({ field: "title", index });
                        updateItem(index, { title: e.target.value });
                      }}
                      onFocus={() => setActiveItemSuggestion({ field: "title", index })}
                      placeholder={t("finance.quotes.editor.placeholders.itemTitle")}
                      value={item.title}
                    />
                    {activeItemSuggestion?.index === index &&
                    activeItemSuggestion.field === "title" ? (
                      <div className="quote-item-suggestions" role="listbox">
                        {getItemSuggestions("title", item.title).map((suggestion) => (
                          <button
                            key={`title-${suggestion}`}
                            onClick={() => applyItemSuggestion(index, "title", suggestion)}
                            onMouseDown={(event) => event.preventDefault()}
                            role="option"
                            type="button"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="quote-item-autocomplete">
                    <input
                      className="field-input quote-items-description-detail"
                      onBlur={() => window.setTimeout(() => setActiveItemSuggestion(null), 120)}
                      onChange={(e) => {
                        setActiveItemSuggestion({ field: "description", index });
                        updateItem(index, { description: e.target.value || null });
                      }}
                      onFocus={() => setActiveItemSuggestion({ field: "description", index })}
                      placeholder={t("finance.quotes.editor.placeholders.itemDetail")}
                      value={item.description ?? ""}
                    />
                    {activeItemSuggestion?.index === index &&
                    activeItemSuggestion.field === "description" ? (
                      <div className="quote-item-suggestions" role="listbox">
                        {getItemSuggestions("description", item.description ?? "").map((suggestion) => (
                          <button
                            key={`description-${suggestion}`}
                            onClick={() => applyItemSuggestion(index, "description", suggestion)}
                            onMouseDown={(event) => event.preventDefault()}
                            role="option"
                            type="button"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <NumberStepper
                  ariaLabel={t("finance.quotes.editor.aria.quantityLine", { line: index + 1 })}
                  className="quote-items-quantity"
                  min={0}
                  onChange={(next) => updateItem(index, { quantity: next })}
                  precision={2}
                  step={1}
                  value={item.quantity}
                />
                <NumberStepper
                  ariaLabel={t("finance.quotes.editor.aria.unitPriceLine", { line: index + 1 })}
                  className="quote-items-price"
                  min={0}
                  onChange={(next) => updateItem(index, { unitPrice: next })}
                  precision={2}
                  step={500}
                  value={item.unitPrice}
                />
                {/* Duration cell. Flat mode renders the unit dropdown
                    full-width (no multiplier makes sense for a flat
                    rate). Day/week/month/unit modes render as
                    [stepper] × [unit ▾] so the × reads as a clear visual
                    multiplication operator. */}
                <div
                  className={`quote-items-duration${isCountableDurationUnit(item.durationUnit) ? " has-multiplier" : " is-flat"}`}
                >
                  {isCountableDurationUnit(item.durationUnit) ? (
                    <>
                      <NumberStepper
                        ariaLabel={t("finance.quotes.editor.aria.durationValueLine", { line: index + 1 })}
                        className="quote-items-duration-value"
                        min={0}
                        onChange={(next) =>
                          updateItem(index, { durationValue: next > 0 ? next : null })
                        }
                        precision={2}
                        step={1}
                        value={item.durationValue ?? 1}
                      />
                      <span className="quote-items-duration-sign" aria-hidden="true">
                        ×
                      </span>
                    </>
                  ) : null}
                  <CompactSelect<QuoteItemDurationUnit>
                    ariaLabel={t("finance.quotes.editor.aria.durationUnitLine", { line: index + 1 })}
                    className="quote-items-duration-unit"
                    value={item.durationUnit ?? "flat"}
                    options={durationUnitOptions.map((opt) => ({
                      value: opt,
                      label: durationUnitLabel(opt),
                    }))}
                    onChange={(nextUnit) => {
                      if (nextUnit === "flat") {
                        updateItem(index, { durationUnit: null, durationValue: null });
                        return;
                      }
                      updateItem(index, {
                        durationUnit: nextUnit,
                        durationValue: item.durationValue ?? 1,
                      });
                    }}
                  />
                </div>
                <CompactSelect<QuoteItemTaxBehavior>
                  ariaLabel={t("finance.quotes.editor.itemColumns.tax")}
                  className="quote-items-tax"
                  value={item.taxBehavior}
                  options={taxBehaviorOptions.map((opt) => ({
                    value: opt,
                    label: taxBehaviorLabel(opt),
                  }))}
                  onChange={(next) => updateItem(index, { taxBehavior: next })}
                />
                <span className="quote-items-cell-total">
                  {breakdown ? formatCurrency(breakdown.lineTotal, draft.currency, language) : "—"}
                </span>
                <button
                  aria-label={t("finance.quotes.editor.aria.removeLine", { line: index + 1 })}
                  className="quote-items-remove"
                  disabled={draft.items.length === 1}
                  onClick={() => removeItem(index)}
                  title={t("finance.quotes.editor.actions.removeLine")}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="surface-card-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
          <button className="ghost-control" onClick={addItem} type="button">
            <Plus size={13} />
            <span>{t("finance.quotes.editor.actions.addLine")}</span>
          </button>
        </div>
      </SurfaceCard>

      <SurfaceCard
        title={t("finance.quotes.editor.totals")}
        subtitle={t("finance.quotes.editor.totalsSubtitle")}
      >
        <div className="totals-breakdown">
          <div className="totals-row">
            <span className="totals-label">{t("finance.quotes.editor.totalsLabels.subtotal")}</span>
            <span className="totals-value">
              {preview ? formatCurrency(preview.subtotal, draft.currency, language) : "—"}
            </span>
          </div>
          {preview && preview.discountAmount > 0 ? (
            <div className="totals-row totals-row-discount">
              <span className="totals-label">{t("finance.quotes.editor.totalsLabels.discount")}</span>
              <span className="totals-value">−{formatCurrency(preview.discountAmount, draft.currency, language)}</span>
            </div>
          ) : null}
          <div className="totals-row">
            <span className="totals-label">
              ITBIS · {(draft.itbisRate * 100).toFixed(2)}%
              {draft.taxAddedToTotal ? null : (
                <HelpHint
                  label={t("finance.quotes.editor.help.itbisNotAddedLabel")}
                  body={t("finance.quotes.editor.help.itbisNotAdded")}
                />
              )}
            </span>
            <span
              className={`totals-value${draft.taxAddedToTotal ? "" : " totals-value-muted"}`}
            >
              {preview ? formatCurrency(preview.taxAmount, draft.currency, language) : "—"}
              {draft.taxAddedToTotal ? null : <small className="totals-tag">{t("finance.quotes.editor.totalsLabels.notAdded")}</small>}
            </span>
          </div>
          <div className="totals-row totals-row-grand">
            <span className="totals-label">{t("finance.quotes.editor.totalsLabels.total")}</span>
            <span className="totals-value">
              {preview ? formatCurrency(preview.total, draft.currency, language) : "—"}
            </span>
          </div>
          {preview && draft.currency !== draft.baseCurrency ? (
            <div className="totals-row totals-row-equivalent">
              <span className="totals-label">
                {t("finance.quotes.editor.totalsLabels.equivalent", { currency: draft.baseCurrency })}
                <HelpHint
                  body={t("finance.quotes.editor.help.equivalent", {
                    rate: draft.exchangeRate,
                    from: draft.currency,
                    to: draft.baseCurrency,
                  })}
                  label={t("finance.quotes.editor.help.equivalentLabel")}
                />
              </span>
              <span className="totals-value">
                {formatCurrency(preview.baseCurrencyTotal, draft.baseCurrency, language)}
              </span>
            </div>
          ) : null}
        </div>
        {preview && preview.warnings.length > 0 ? (
          <div className="warning-banner">
            {preview.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}
      </SurfaceCard>

      <div className="surface-card-actions" style={{ justifyContent: "flex-end", gap: 8 }}>
        {!isNew && existingQuote ? (
          <button className="ghost-control" onClick={() => void handleExportPdf()} type="button">
            <Download size={13} />
            <span>{t("finance.quotes.editor.actions.exportPdf")}</span>
          </button>
        ) : null}
        {!isNew && existingQuote?.status === "approved" ? (
          <button className="ghost-control" onClick={() => void handleGenerateInvoice()} type="button">
            <ReceiptText size={13} />
            <span>{t("finance.quotes.editor.actions.generateInvoice")}</span>
          </button>
        ) : null}
        {!isNew && existingQuote?.status === "draft" ? (
          <button
            className="ghost-control"
            onClick={() => void handleSetStatus("sent")}
            type="button"
          >
            <Send size={13} />
            <span>{t("finance.quotes.editor.actions.markSent")}</span>
          </button>
        ) : null}
        {!isNew && existingQuote?.status === "sent" ? (
          <>
            <button
              className="ghost-control"
              onClick={() => void handleSetStatus("approved")}
              type="button"
            >
              {t("finance.quotes.editor.actions.markApproved")}
            </button>
            <button
              className="ghost-control is-danger"
              onClick={() => void handleSetStatus("rejected")}
              type="button"
            >
              {t("finance.quotes.editor.actions.markRejected")}
            </button>
          </>
        ) : null}
        <button
          className="action-primary-button"
          disabled={isSaving || (!isNew && existingQuote?.status !== "draft")}
          onClick={() => void handleSave()}
          type="button"
        >
          <Save size={13} />
          <span>{isSaving ? t("common.saving") : isNew ? t("finance.quotes.editor.actions.createDraft") : t("common.saveChanges")}</span>
        </button>
      </div>
    </div>
  );
};

export default QuoteEditorPage;
