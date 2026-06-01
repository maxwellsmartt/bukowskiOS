import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

import { extractDocumentFromBuffer } from "../data/documentExtractionService";
import type { AISecretStore } from "./aiSecretStore";
import type { AnthropicProviderService } from "./anthropicProviderService";
import type { OpenAIProviderService } from "./openaiProviderService";
import type { InvoiceExtractionFields } from "../data/invoiceInboxService";

const isImageMime = (mimeType: string) => /^image\/(png|jpe?g|webp)/i.test(mimeType.trim());
const isPdfMime = (mimeType: string, fileName: string) =>
  /pdf/i.test(mimeType) || fileName.toLowerCase().endsWith(".pdf");

const EXTRACTION_INSTRUCTIONS = `Eres un asistente contable dominicano experto en facturas de gasto (compras, 606 DGII).
Extrae los datos de la factura adjunta y responde ÚNICAMENTE con un objeto JSON válido, sin texto extra ni \`\`\`.

Reglas estrictas:
- NUNCA inventes datos. Si un dato no aparece claramente, devuelve null.
- Fechas SIEMPRE en formato ISO YYYY-MM-DD. En RD las facturas suelen venir como DD/MM/YYYY: conviértelas (ej. "05/03/2026" → "2026-03-05"). Si solo hay mes y año, usa el día 01.
- Montos como número sin separador de miles ni símbolo. En RD el punto suele ser separador de miles y la coma decimal, pero también se usa el formato anglosajón: interpreta correctamente (ej. "1.234,56" y "1,234.56" valen 1234.56).
- El ITBIS es el impuesto (normalmente 18%). total = subtotal + itbis cuando aplica; verifica la coherencia.

Campos (usa null cuando no aparezca el dato):
- supplierName: nombre/razón social del proveedor (string|null)
- supplierRnc: RNC o cédula del proveedor, solo dígitos (string|null)
- ncf: comprobante fiscal NCF (ej. B0100000001) (string|null)
- invoiceDate: fecha de la factura en formato YYYY-MM-DD (string|null)
- subtotal: monto antes de impuestos (number|null)
- itbis: monto de ITBIS/impuesto (number|null)
- total: monto total a pagar (number|null)
- currency: ISO 4217, normalmente "DOP" (string|null)
- dgiiExpenseType: tipo de gasto DGII 01-11 si lo infieres (string|null)
- expenseCategory: categoría de gasto en lenguaje natural (ej. "Combustible", "Alquiler", "Servicios") (string|null)
- confidence: tu confianza global 0..1 (number)`;

/** Normalize a model-supplied date string to ISO YYYY-MM-DD (best-effort). */
const normalizeIsoDate = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(trimmed);
  if (dmy) {
    const [, dd, mm, yyyyRaw] = dmy;
    const yyyy = yyyyRaw.length === 2 ? `20${yyyyRaw}` : yyyyRaw;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return trimmed;
};

const loadSupervisor = (db: DatabaseSync, workspaceId: string) =>
  db
    .prepare(
      `SELECT workspace_id, provider_key, model_key
         FROM agents
        WHERE workspace_id IN (?, ?) AND is_supervisor = 1
        ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END
        LIMIT 1`,
    )
    .get(workspaceId, DEFAULT_WORKSPACE_ID, workspaceId) as
    | { workspace_id: string; provider_key: string; model_key: string }
    | undefined;

const loadProvider = (db: DatabaseSync, providerKey: string, workspaceId: string) =>
  db
    .prepare(
      `SELECT enabled, default_model_key, base_url, timeout_ms
         FROM ai_provider_configs
        WHERE workspace_id IN (?, ?) AND provider_key = ?
        ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END
        LIMIT 1`,
    )
    .get(workspaceId, DEFAULT_WORKSPACE_ID, providerKey, workspaceId) as
    | { enabled: number; default_model_key: string; base_url: string; timeout_ms: number }
    | undefined;

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/\.(?=.*\.)/g, "").replace(/,/g, "");
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
};

const normalizeCurrencyCode = (value: string | null): string | null => {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (!normalized) return null;
  if (normalized === "RD" || normalized === "RD$" || normalized === "PESOS" || normalized === "PESO") return "DOP";
  if (normalized === "US" || normalized === "US$" || normalized === "$" || normalized === "DOLLARS") return "USD";
  return normalized;
};

const inferCurrency = (modelCurrency: string | null, supplierName: string | null, rawText: string): string | null => {
  const normalizedModelCurrency = normalizeCurrencyCode(modelCurrency);
  const text = `${supplierName ?? ""}\n${rawText}`.toLowerCase();
  const hasExplicitUsd =
    /\busd\b|us\$|u\.s\. dollars?|united states dollars?|\bdollars?\b/.test(text) ||
    /(amount due|total due|balance due|total|invoice total)\s*\$/.test(text);
  const hasExplicitDop = /\bdop\b|rd\$|pesos dominicanos?|itbis|rnc|ncf/.test(text);
  const looksLikeInternationalUsdSupplier =
    /(anthropic|openai|stripe|github|google|aws|amazon web services|adobe|figma|notion|vercel|netlify|cloudflare|apple)/.test(
      text,
    );

  if (hasExplicitUsd && !hasExplicitDop) return "USD";
  if (looksLikeInternationalUsdSupplier && /\$/.test(text)) return "USD";
  if (normalizedModelCurrency) return normalizedModelCurrency;
  if (hasExplicitDop) return "DOP";
  if (hasExplicitUsd) return "USD";
  return null;
};

/** Pull the first balanced JSON object out of a model reply (handles fences). */
const parseJsonObject = (text: string): Record<string, unknown> => {
  const withoutFences = text.replace(/```(?:json)?/gi, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("El modelo no devolvió JSON de factura.");
  }
  return JSON.parse(withoutFences.slice(start, end + 1)) as Record<string, unknown>;
};

const mapFields = (data: Record<string, unknown>, rawText: string): InvoiceExtractionFields => {
  const confidence = toNumberOrNull(data.confidence);
  const supplierName = toStringOrNull(data.supplierName);
  return {
    supplierName,
    supplierRnc: toStringOrNull(data.supplierRnc)?.replace(/[^0-9]/g, "") || null,
    ncf: toStringOrNull(data.ncf),
    invoiceDate: normalizeIsoDate(toStringOrNull(data.invoiceDate)),
    subtotal: toNumberOrNull(data.subtotal),
    itbis: toNumberOrNull(data.itbis),
    total: toNumberOrNull(data.total),
    currency: inferCurrency(toStringOrNull(data.currency), supplierName, rawText),
    dgiiExpenseType: toStringOrNull(data.dgiiExpenseType),
    expenseCategory: toStringOrNull(data.expenseCategory),
    confidence: confidence != null ? Math.max(0, Math.min(1, confidence)) : null,
    rawText: rawText.slice(0, 8_000) || null,
  };
};

export type InvoiceExtractionServiceOptions = {
  secretStore: Pick<AISecretStore, "getProviderSecret">;
  openaiProviderService: OpenAIProviderService;
  anthropicProviderService?: AnthropicProviderService;
};

export const createInvoiceExtractionService = (
  db: DatabaseSync,
  options: InvoiceExtractionServiceOptions,
) => {
  const extract = async (
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    workspaceId: string,
  ): Promise<InvoiceExtractionFields> => {
    const supervisor = loadSupervisor(db, workspaceId);
    const providerKey = supervisor?.provider_key ?? "openai";
    const provider = loadProvider(db, providerKey, supervisor?.workspace_id ?? workspaceId);
    if (!provider || provider.enabled !== 1) {
      throw new Error("No hay un proveedor de IA habilitado para clasificar facturas.");
    }
    const apiKey =
      options.secretStore.getProviderSecret(supervisor?.workspace_id ?? workspaceId, providerKey) ??
      options.secretStore.getProviderSecret(DEFAULT_WORKSPACE_ID, providerKey);
    if (!apiKey) {
      throw new Error("Falta la API key del proveedor de IA.");
    }
    const model = supervisor?.model_key ?? provider.default_model_key;
    const providerService =
      providerKey === "anthropic" && options.anthropicProviderService
        ? options.anthropicProviderService
        : options.openaiProviderService;

    const isImage = isImageMime(mimeType);
    let pdfText = "";
    if (!isImage) {
      if (!isPdfMime(mimeType, fileName)) {
        throw new Error(`Formato no soportado para extracción: ${mimeType}`);
      }
      const extracted = await extractDocumentFromBuffer(buffer, mimeType, fileName);
      pdfText = extracted.text.trim();
      if (!pdfText) {
        throw new Error("PDF sin texto (escaneado): usa una imagen o un PDF digital con texto.");
      }
    }
    const dataUrl = isImage ? `data:${mimeType};base64,${buffer.toString("base64")}` : "";

    // Build the model input for a given instruction string. Images send the
    // bitmap at high detail; PDFs send their extracted text.
    const buildInput = (instructions: string): string | Array<Record<string, unknown>> =>
      isImage
        ? [
            {
              role: "user",
              content: [
                { type: "input_text", text: instructions },
                { type: "input_image", image_url: dataUrl, detail: "high" },
              ],
            },
          ]
        : `${instructions}\n\nTexto de la factura:\n${pdfText}`;

    // Deterministic single call (temperature 0) for a given instruction set.
    // Some newer/reasoning models reject `temperature`; if so, retry once
    // without it rather than failing the whole extraction.
    const callModel = async (
      instructions: string,
      useTemperature = true,
    ): Promise<Record<string, unknown>> => {
      const response = await providerService.createResponse(
        {
          apiKey,
          baseUrl: provider.base_url,
          defaultModelKey: model,
          timeoutMs: Math.max(20_000, provider.timeout_ms),
        },
        {
          model,
          instructions: "Extrae datos de facturas y responde solo JSON.",
          input: buildInput(instructions),
          maxOutputTokens: 900,
          temperature: useTemperature ? 0 : undefined,
        },
      );
      if (!response.ok) {
        if (useTemperature && /temperature/i.test(response.summary ?? "")) {
          return callModel(instructions, false);
        }
        throw new Error(response.summary || "El proveedor de IA no pudo procesar la factura.");
      }
      return parseJsonObject(response.outputText);
    };

    let fields = mapFields(await callModel(EXTRACTION_INSTRUCTIONS), isImage ? "" : pdfText);

    // One targeted repair pass when the two most critical fields are missing —
    // the date and total are exactly what users reported as inconsistent.
    if (fields.total == null || fields.invoiceDate == null) {
      try {
        const repairInstructions = `${EXTRACTION_INSTRUCTIONS}\n\nIMPORTANTE: en el intento anterior faltó ${
          [fields.total == null ? "el TOTAL" : null, fields.invoiceDate == null ? "la FECHA" : null]
            .filter(Boolean)
            .join(" y ")
        }. Búscalo con cuidado en el documento (encabezado, pie, totales) y devuélvelo. No inventes; si de verdad no está, usa null.`;
        const repaired = mapFields(await callModel(repairInstructions), isImage ? "" : pdfText);
        fields = {
          ...fields,
          invoiceDate: fields.invoiceDate ?? repaired.invoiceDate,
          total: fields.total ?? repaired.total,
          subtotal: fields.subtotal ?? repaired.subtotal,
          itbis: fields.itbis ?? repaired.itbis,
        };
      } catch {
        // Keep the first-pass result if the repair call fails.
      }
    }

    return fields;
  };

  return { extract };
};

export type InvoiceExtractionService = ReturnType<typeof createInvoiceExtractionService>;
