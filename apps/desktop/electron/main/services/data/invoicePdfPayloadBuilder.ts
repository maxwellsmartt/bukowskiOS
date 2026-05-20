import type { CurrencySettingsRow, InvoiceDetail } from "@contracts";

import type { InvoicePdfPayload } from "./documentGenerationService";

const formatDateDdMmYyyy = (iso: string | null): string | null => {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const currencySymbol = (code: string): string => {
  const c = code.trim().toUpperCase();
  if (c === "DOP") return "RD$";
  if (c === "USD") return "US$";
  if (c === "EUR") return "€";
  return c;
};

export type WorkspaceProfileForInvoice = {
  legalName: string;
  rnc: string;
  addressLines: string[];
  phone: string;
  web: string;
  email: string;
};

const defaultMetadataProfile: WorkspaceProfileForInvoice = {
  legalName: "METADATA CINE S.R.L.",
  rnc: "131-20642-5",
  addressLines: ["Calle Central, # 27, Galá, Sto. Dgo.", "Distrito Nacional, Rep. Dom."],
  phone: "(809) 424-4533 / (849) 630-2244",
  web: "www.metadatacine.net",
  email: "info@metadatacine.com",
};

export type BuildInvoicePdfPayloadInput = {
  invoice: InvoiceDetail;
  currencySettings: CurrencySettingsRow;
  workspaceProfile?: WorkspaceProfileForInvoice;
  logoBuffer?: Buffer | null;
  sourceQuoteNumber?: string | null;
};

export const buildInvoicePdfPayload = (input: BuildInvoicePdfPayloadInput): InvoicePdfPayload => {
  const { invoice, currencySettings } = input;
  const profile = input.workspaceProfile ?? defaultMetadataProfile;

  return {
    invoiceNumber: invoice.invoiceNumber,
    ncf: invoice.ncf,
    status: invoice.status.replace(/_/g, " ").toUpperCase(),
    issueDate: formatDateDdMmYyyy(invoice.issueDate) ?? invoice.issueDate,
    dueDate: formatDateDdMmYyyy(invoice.dueDate),
    sourceQuoteNumber: input.sourceQuoteNumber ?? invoice.sourceQuoteId,
    workspace: {
      legalName: profile.legalName,
      rnc: profile.rnc,
      sirecineNumber: invoice.workspaceSirecineSnapshot ?? currencySettings.sirecineNumber ?? null,
      addressLines: profile.addressLines,
      phone: profile.phone,
      web: profile.web,
      email: profile.email,
      logoBuffer: input.logoBuffer ?? null,
    },
    client: {
      name: invoice.clientNameSnapshot,
      rnc: invoice.clientRncSnapshot,
      attentionName: invoice.attentionName,
      phone: invoice.attentionPhone,
      productionName: invoice.productionName,
      productionCompanyName: invoice.productionCompanyNameSnapshot,
      projectName: invoice.projectNameSnapshot,
      pur: invoice.productionPurSnapshot,
    },
    currency: {
      code: invoice.currency,
      symbol: currencySymbol(invoice.currency),
    },
    exchangeRate: {
      rate: invoice.exchangeRate,
      source: invoice.exchangeRateSource,
      effectiveDate: formatDateDdMmYyyy(invoice.exchangeRateEffectiveDate),
    },
    items: invoice.items.map((item) => ({
      quantity: item.quantity,
      title: item.title,
      description: item.description,
      durationValue: item.durationValue,
      durationUnit: item.durationUnit,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      taxAmount: item.taxAmount,
      lineTotal: item.lineTotal,
    })),
    totals: {
      subtotal: invoice.subtotalAmount,
      discountAmount: invoice.discountAmount,
      taxAmount: invoice.taxAmount,
      total: invoice.totalAmount,
      paid: invoice.paidAmount,
      outstanding: invoice.outstandingAmount,
    },
    payments: invoice.payments.map((payment) => ({
      paidAt: formatDateDdMmYyyy(payment.paidAt) ?? payment.paidAt,
      amount: payment.amount,
      method: payment.paymentMethod,
      reference: payment.reference,
    })),
    observations: invoice.observations,
  };
};
