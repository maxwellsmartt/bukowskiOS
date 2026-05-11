import { ArrowLeft, Clock, Download, GripVertical, History, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type {
  CurrencyRateSource,
  CurrencyRateType,
  QuoteItemInput,
  QuoteItemTaxBehavior,
  QuoteTaxProfile,
} from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
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
import { fetchLatestRate, useCurrencySettings } from "./useCurrencyData";
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

const taxBehaviorOptions: Array<{ value: QuoteItemTaxBehavior; label: string }> = [
  { value: "follows_quote", label: "Follows quote" },
  { value: "taxable", label: "Taxable" },
  { value: "exempt", label: "Exempt" },
  { value: "show_only", label: "Show only" },
  { value: "included", label: "Tax included" },
];

const taxProfileOptions: QuoteTaxProfile[] = ["standard_itbis", "film_law_exempt", "mixed", "manual"];

export const QuoteEditorPage = () => {
  const { quoteId } = useParams<{ quoteId: string }>();
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
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
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
          eyebrow="Finance"
          title={isNew ? "New quote" : "Quote"}
          body={isLoadingQuote ? "Loading quote…" : "Preparing quote draft…"}
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
      `${template.label} loaded`,
      "We pre-filled the items — adjust quantities, prices and durations to match this client.",
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
        "Add the client name to continue",
        "We use it on the PDF header and in your quote list.",
      );
      return;
    }
    if (draft.items.some((item) => !item.title.trim())) {
      toast.error(
        "One of your line items has no title",
        "Give every line a short name (e.g. \"DIT operator\") so the PDF reads cleanly.",
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
          `Quote ${result.quoteNumber} is ready`,
          "Draft saved. Export the PDF or send it when you're done.",
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
        toast.success("Quote updated", "Your changes were saved as a new version.");
        refresh();
        refreshVersions();
      }
    } catch (err) {
      toast.error(
        "We couldn't save the quote",
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
          : "Check your internet and try again.",
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
        toast.success("PDF ready", result.summary ?? "We saved your quote PDF.");
      } else {
        toast.info("Export cancelled", "Nothing was saved — try again when you're ready.");
      }
    } catch (err) {
      toast.error(
        "We couldn't export the PDF",
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
          : "Try again in a moment.",
      );
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
      toast.success(`Quote moved to ${statusLabel(status)}`, "We logged the change in the quote history.");
      refresh();
    } catch (err) {
      toast.error(
        "We couldn't change the status",
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
          : "Try again in a moment.",
      );
    }
  };

  return (
    <div className="page-stack">
      <div className="page-stack-row">
        <button className="ghost-control" onClick={() => navigate("/finance/quotes")} type="button">
          <ArrowLeft size={13} />
          <span>All quotes</span>
        </button>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!isNew && versions.length > 0 ? (
            <button
              className="ghost-control"
              onClick={() => setIsVersionsOpen((prev) => !prev)}
              type="button"
            >
              <History size={13} />
              <span>{versions.length} version{versions.length === 1 ? "" : "s"}</span>
            </button>
          ) : null}
          {existingQuote ? (
            <StatusBadge tone={statusTone(existingQuote.status)}>{statusLabel(existingQuote.status)}</StatusBadge>
          ) : null}
        </div>
      </div>

      {isVersionsOpen && !isNew ? (
        <SurfaceCard
          subtitle="Snapshots saved automatically each time you edit. Older quotes never silently change because we keep these for the audit trail."
          title="Version history"
        >
          <div className="quote-versions-timeline">
            {versions.map((version) => {
              const total =
                typeof version.snapshot.total === "number"
                  ? formatCurrency(version.snapshot.total, String(version.snapshot.currency ?? draft.currency), language)
                  : "—";
              return (
                <div className="quote-versions-row" key={version.id}>
                  <div className="quote-versions-marker">
                    <span className="quote-versions-dot" />
                    <span className="quote-versions-line" />
                  </div>
                  <div className="quote-versions-body">
                    <div className="quote-versions-head">
                      <strong>v{version.versionNumber}</strong>
                      <span className="text-muted">
                        <Clock size={11} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                        {version.createdAt.slice(0, 16).replace("T", " ")}
                      </span>
                      <span className="quote-versions-total">{total}</span>
                    </div>
                    {version.changeSummary ? (
                      <p className="quote-versions-summary">{version.changeSummary}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      ) : null}

      <SectionHeader
        eyebrow={isNew ? "Finance · New" : `Finance · ${existingQuote?.quoteNumber ?? ""}`}
        title={isNew ? "New quote" : `Quote ${existingQuote?.quoteNumber ?? ""}`}
        body={
          isNew
            ? "Client, package, items, exchange rate and tax profile. The PDF stays in Spanish for Iván's clients."
            : `Created ${existingQuote?.createdAt?.slice(0, 10)} · Updated ${existingQuote?.updatedAt?.slice(0, 10)}`
        }
        titleTone="accent"
      />

      {isNew ? (
        <SurfaceCard title="Quick start" subtitle="Pick a Metadata template to pre-fill the quote, then tweak.">
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

      <SurfaceCard title="Client & production">
        <div className="agent-form-grid">
          <label className="field-block">
            <span className="field-label">Client name *</span>
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
            <span className="field-label">Client RNC</span>
            <input
              className="field-input"
              list="quote-recent-rncs"
              onChange={(e) => updateDraft("clientRncSnapshot", e.target.value)}
              placeholder="1-30-12345-6"
              value={draft.clientRncSnapshot}
            />
          </label>
          <label className="field-block">
            <span className="field-label">Production company</span>
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
            <span className="field-label">PUR (Permiso Único de Rodaje)</span>
            <input
              className="field-input"
              list="quote-recent-purs"
              onChange={(e) => updateDraft("productionPurSnapshot", e.target.value)}
              value={draft.productionPurSnapshot}
            />
          </label>
          <label className="field-block">
            <span className="field-label">Sirecine number</span>
            <input
              className="field-input"
              list="quote-recent-sirecines"
              onChange={(e) => updateDraft("workspaceSirecineSnapshot", e.target.value)}
              value={draft.workspaceSirecineSnapshot}
            />
          </label>
          <label className="field-block">
            <span className="field-label">Attention to</span>
            <input
              className="field-input"
              list="quote-recent-attention"
              onChange={(e) => updateDraft("attentionName", e.target.value)}
              value={draft.attentionName}
            />
          </label>
          <label className="field-block">
            <span className="field-label">Phone</span>
            <input
              className="field-input"
              list="quote-recent-phones"
              onChange={(e) => updateDraft("attentionPhone", e.target.value)}
              value={draft.attentionPhone}
            />
          </label>
          <label className="field-block field-block-span-2">
            <span className="field-label">Project / Production</span>
            <input
              className="field-input"
              list="quote-recent-projects"
              onChange={(e) => updateDraft("projectNameSnapshot", e.target.value)}
              placeholder="Aurora Series"
              value={draft.projectNameSnapshot}
            />
          </label>
          <label className="field-block field-block-span-2">
            <span className="field-label">Package title (eyebrow on PDF)</span>
            <input
              className="field-input"
              list="quote-recent-packages"
              onChange={(e) => updateDraft("packageTitle", e.target.value)}
              placeholder="DIT / Data Management"
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
            <span className="field-label">Description</span>
            <textarea
              className="field-input"
              onChange={(e) => updateDraft("description", e.target.value)}
              placeholder="Short description shown above the line items."
              rows={2}
              value={draft.description}
            />
          </label>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Currency & tax">
        <div className="agent-form-grid">
          <label className="field-block">
            <span className="field-label">Quote date</span>
            <input
              className="field-input"
              onChange={(e) => updateDraft("quoteDate", e.target.value)}
              type="date"
              value={draft.quoteDate}
            />
          </label>
          <label className="field-block">
            <span className="field-label">Validity (days)</span>
            <NumberStepper
              align="left"
              ariaLabel="Validity in days"
              max={365}
              min={1}
              onChange={(next) => updateDraft("validityDays", next)}
              value={draft.validityDays}
            />
          </label>
          <label className="field-block">
            <span className="field-label">Currency</span>
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
              Exchange rate ({draft.currency} → {draft.baseCurrency})
            </span>
            <NumberStepper
              align="left"
              ariaLabel="Exchange rate"
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
                title={`Use latest rate from ${rateSuggestion.effectiveDate}`}
                type="button"
              >
                Use latest: {rateSuggestion.rate} ({rateSuggestion.effectiveDate})
              </button>
            ) : null}
          </label>
          <label className="field-block field-block-span-2">
            <span className="field-label">Tax profile</span>
            <select
              className="field-input"
              onChange={(event) => updateDraft("taxProfile", event.target.value as typeof draft.taxProfile)}
              value={draft.taxProfile}
            >
              {taxProfileOptions.map((profile) => (
                <option key={profile} value={profile}>
                  {taxProfileLabel(profile)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="field-label">ITBIS rate</span>
            <NumberStepper
              align="left"
              ariaLabel="ITBIS rate"
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
            <span className="field-label">Add ITBIS to total</span>
            <select
              className="field-input"
              onChange={(e) => updateDraft("taxAddedToTotal", e.target.value === "yes")}
              value={draft.taxAddedToTotal ? "yes" : "no"}
            >
              <option value="yes">Yes — add ITBIS to total</option>
              <option value="no">No — show ITBIS but don't add</option>
            </select>
          </label>
        </div>
      </SurfaceCard>

      <SurfaceCard
        title="Line items"
        subtitle="Title, quantity, unit price and tax behavior. Drag your eyes — the live preview totals show below."
      >
        <div className="quote-items-grid">
          <div className="quote-items-header">
            <span aria-hidden="true" />
            <span>Description</span>
            <span>Qty</span>
            <span>Unit price</span>
            <span className="quote-items-header-tax">
              Tax
              <HelpHint
                body="How this line is taxed: Follows quote — uses the quote profile. Taxable — adds ITBIS to the line. Exempt — no ITBIS. Show only — shows ITBIS but doesn't add (Ley de Cine). Included — price already contains ITBIS."
                label="Tax behavior"
              />
            </span>
            <span>Total</span>
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
                  aria-label={`Drag to reorder line ${index + 1}`}
                  className="quote-items-drag"
                  draggable
                  onDragStart={handleDragStart(index)}
                  title="Drag to reorder"
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
                      placeholder="DIT operator"
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
                      placeholder="Optional detail (Mac Studio M1, Davinci Resolve…)"
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
                  ariaLabel={`Quantity for line ${index + 1}`}
                  className="quote-items-quantity"
                  min={0}
                  onChange={(next) => updateItem(index, { quantity: next })}
                  precision={2}
                  step={1}
                  value={item.quantity}
                />
                <NumberStepper
                  ariaLabel={`Unit price for line ${index + 1}`}
                  className="quote-items-price"
                  min={0}
                  onChange={(next) => updateItem(index, { unitPrice: next })}
                  precision={2}
                  step={500}
                  value={item.unitPrice}
                />
                <select
                  className="field-input quote-items-tax"
                  onChange={(e) =>
                    updateItem(index, { taxBehavior: e.target.value as QuoteItemTaxBehavior })
                  }
                  value={item.taxBehavior}
                >
                  {taxBehaviorOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="quote-items-cell-total">
                  {breakdown ? formatCurrency(breakdown.lineTotal, draft.currency, language) : "—"}
                </span>
                <button
                  aria-label={`Remove line ${index + 1}`}
                  className="quote-items-remove"
                  disabled={draft.items.length === 1}
                  onClick={() => removeItem(index)}
                  title="Remove this line"
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
            <span>Add line</span>
          </button>
        </div>
      </SurfaceCard>

      <SurfaceCard
        title="Totals"
        subtitle="Live preview — these are the numbers that will print on the PDF."
      >
        <div className="totals-breakdown">
          <div className="totals-row">
            <span className="totals-label">Subtotal</span>
            <span className="totals-value">
              {preview ? formatCurrency(preview.subtotal, draft.currency, language) : "—"}
            </span>
          </div>
          {preview && preview.discountAmount > 0 ? (
            <div className="totals-row totals-row-discount">
              <span className="totals-label">Discount</span>
              <span className="totals-value">−{formatCurrency(preview.discountAmount, draft.currency, language)}</span>
            </div>
          ) : null}
          <div className="totals-row">
            <span className="totals-label">
              ITBIS · {(draft.itbisRate * 100).toFixed(2)}%
              {draft.taxAddedToTotal ? null : (
                <HelpHint
                  body="Ley de Cine treatment: ITBIS is calculated and shown on the PDF (with ** marker), but it is NOT added to the total. Toggle 'Add ITBIS to total' above if this client pays ITBIS."
                  label="ITBIS not added"
                />
              )}
            </span>
            <span
              className={`totals-value${draft.taxAddedToTotal ? "" : " totals-value-muted"}`}
            >
              {preview ? formatCurrency(preview.taxAmount, draft.currency, language) : "—"}
              {draft.taxAddedToTotal ? null : <small className="totals-tag">not added</small>}
            </span>
          </div>
          <div className="totals-row totals-row-grand">
            <span className="totals-label">Total</span>
            <span className="totals-value">
              {preview ? formatCurrency(preview.total, draft.currency, language) : "—"}
            </span>
          </div>
          {preview && draft.currency !== draft.baseCurrency ? (
            <div className="totals-row totals-row-equivalent">
              <span className="totals-label">
                ≈ in {draft.baseCurrency}
                <HelpHint
                  body={`Snapshot rate ${draft.exchangeRate} ${draft.currency}→${draft.baseCurrency}. This will not change once the quote is saved, even if you update the rate later.`}
                  label="Equivalent calculation"
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
            <span>Export PDF</span>
          </button>
        ) : null}
        {!isNew && existingQuote?.status === "draft" ? (
          <button
            className="ghost-control"
            onClick={() => void handleSetStatus("sent")}
            type="button"
          >
            <Send size={13} />
            <span>Mark sent</span>
          </button>
        ) : null}
        {!isNew && existingQuote?.status === "sent" ? (
          <>
            <button
              className="ghost-control"
              onClick={() => void handleSetStatus("approved")}
              type="button"
            >
              Mark approved
            </button>
            <button
              className="ghost-control is-danger"
              onClick={() => void handleSetStatus("rejected")}
              type="button"
            >
              Mark rejected
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
          <span>{isSaving ? "Saving…" : isNew ? "Create draft" : "Save changes"}</span>
        </button>
      </div>
    </div>
  );
};

export default QuoteEditorPage;
