import type { CurrencySettingsRow, QuoteDetail } from "@contracts";

import type { QuotePdfPayload } from "./documentGenerationService";
import { calculateQuote } from "./quoteCalculationService";

const formatDateDdMmYyyy = (iso: string): string => {
  // Accepts "YYYY-MM-DD" and returns "DD/MM/YYYY" to match Iván's PDFs.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return iso ?? "";
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const currencySymbol = (code: string): string => {
  const c = code.trim().toUpperCase();
  if (c === "DOP") return "$";
  if (c === "USD") return "US$";
  if (c === "EUR") return "€";
  return "$";
};

const splitDescription = (
  title: string,
  description: string | null,
): { titleLine: string; detailLines: string[] } => {
  const titleLine = title.trim();
  const detailLines = description
    ? description
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return { titleLine, detailLines };
};

const durationUnitToSpanish = (unit: string | null): string => {
  switch ((unit ?? "").toLowerCase()) {
    case "day":
      return "DIAS";
    case "week":
      return "SEM";
    case "month":
      return "MES";
    case "unit":
      return "UND";
    case "flat":
      return "";
    default:
      return (unit ?? "").toUpperCase();
  }
};

export type WorkspaceProfileForQuote = {
  legalName: string;
  rnc: string;
  addressLines: string[];
  phone: string;
  web: string;
  email: string;
  signatoryName: string;
};

const defaultMetadataProfile: WorkspaceProfileForQuote = {
  legalName: "METADATA CINE S.R.L.",
  rnc: "131-20642-5",
  addressLines: ["Calle Central, # 27, Galá, Sto. Dgo.", "Distrito Nacional, Rep. Dom."],
  phone: "(809) 424-4533 / (849) 630-2244",
  web: "www.metadatacine.net",
  email: "info@metadatacine.com",
  signatoryName: "Rhadamés Iván Jiménez",
};

export type BuildQuotePdfPayloadInput = {
  quote: QuoteDetail;
  currencySettings: CurrencySettingsRow;
  /** Workspace identity. Defaults to the Metadata profile when not provided. */
  workspaceProfile?: WorkspaceProfileForQuote;
  /** Optional asset buffers for logo / sello / firma. */
  logoBuffer?: Buffer | null;
  sealBuffer?: Buffer | null;
  signatureBuffer?: Buffer | null;
};

export const buildQuotePdfPayload = (input: BuildQuotePdfPayloadInput): QuotePdfPayload => {
  const { quote, currencySettings } = input;
  const profile = input.workspaceProfile ?? defaultMetadataProfile;

  // Recompute totals + line breakdowns through the current calculation logic.
  // This guarantees that quotes saved with older calc rules (before the
  // duration multiplier / Ley-de-Cine-aware line totals fixes) still render
  // correctly without needing a re-save.
  const recomputed = calculateQuote({
    currency: quote.currency,
    baseCurrency: quote.baseCurrency,
    exchangeRate: quote.exchangeRate,
    taxProfile: quote.taxProfile,
    itbisRate: quote.itbisRate,
    taxAddedToTotal: quote.taxAddedToTotal,
    discountRate: quote.discountRate,
    discountAmount: quote.discountAmount > 0 ? quote.discountAmount : null,
    items: quote.items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      durationValue: item.durationValue ?? null,
      discountRate: item.discountRate ?? null,
      discountAmount: null,
      taxBehavior: item.taxBehavior,
      taxRate: item.taxRate ?? null,
    })),
  });

  return {
    quoteNumber: quote.quoteNumber,
    quoteDate: formatDateDdMmYyyy(quote.quoteDate),
    validityDays: quote.validityDays,
    packageTitle: quote.packageTitle,
    description: quote.description,
    workspace: {
      legalName: profile.legalName,
      rnc: profile.rnc,
      sirecineNumber: quote.workspaceSirecineSnapshot ?? currencySettings.sirecineNumber ?? null,
      addressLines: profile.addressLines,
      phone: profile.phone,
      web: profile.web,
      email: profile.email,
      logoBuffer: input.logoBuffer ?? null,
      sealBuffer: input.sealBuffer ?? null,
      signatureBuffer: input.signatureBuffer ?? null,
      signatoryName: profile.signatoryName,
    },
    client: {
      attentionName: quote.attentionName,
      productionName: quote.productionName,
      projectName: quote.projectNameSnapshot,
      descriptionLabel: quote.description,
      phone: quote.attentionPhone,
      rnc: quote.clientRncSnapshot,
      pur: quote.productionPurSnapshot,
    },
    currency: {
      code: quote.currency,
      symbol: currencySymbol(quote.currency),
    },
    items: quote.items.map((item, index) => {
      const { titleLine, detailLines } = splitDescription(item.title, item.description);
      const durationValue =
        item.durationValue === null || item.durationValue === undefined
          ? null
          : Number.isInteger(item.durationValue)
            ? String(item.durationValue)
            : item.durationValue.toFixed(2).replace(/\.?0+$/, "");
      const breakdown = recomputed.itemBreakdowns[index];
      return {
        quantity: item.quantity,
        titleLine,
        detailLines,
        durationValue,
        durationUnit: durationUnitToSpanish(item.durationUnit),
        unitPrice: item.unitPrice,
        // Use the freshly recomputed line total so old quotes also reflect
        // the current Ley-de-Cine-aware + duration-multiplied logic.
        lineTotal: breakdown ? breakdown.lineTotal : item.lineTotal,
      };
    }),
    totals: {
      subtotal: recomputed.subtotal,
      discountLabel: recomputed.discountAmount > 0 ? "DESCUENTO ESPECIAL (PAQUETE)" : null,
      discountRate: quote.discountRate,
      discountAmount: recomputed.discountAmount,
      taxRate: quote.itbisRate,
      taxAmount: recomputed.taxAmount,
      taxAddedToTotal: quote.taxAddedToTotal,
      total: recomputed.total,
    },
    observations: quote.observations,
  };
};
