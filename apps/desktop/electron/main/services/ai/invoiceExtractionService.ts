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
  return {
    supplierName: toStringOrNull(data.supplierName),
    supplierRnc: toStringOrNull(data.supplierRnc)?.replace(/[^0-9]/g, "") || null,
    ncf: toStringOrNull(data.ncf),
    invoiceDate: toStringOrNull(data.invoiceDate),
    subtotal: toNumberOrNull(data.subtotal),
    itbis: toNumberOrNull(data.itbis),
    total: toNumberOrNull(data.total),
    currency: toStringOrNull(data.currency)?.toUpperCase() || null,
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

    let input: string | Array<Record<string, unknown>>;
    let pdfText = "";

    if (isImageMime(mimeType)) {
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      input = [
        {
          role: "user",
          content: [
            { type: "input_text", text: EXTRACTION_INSTRUCTIONS },
            { type: "input_image", image_url: dataUrl },
          ],
        },
      ];
    } else if (isPdfMime(mimeType, fileName)) {
      const extracted = await extractDocumentFromBuffer(buffer, mimeType, fileName);
      pdfText = extracted.text.trim();
      if (!pdfText) {
        throw new Error("PDF sin texto (escaneado): usa una imagen o un PDF digital con texto.");
      }
      input = `${EXTRACTION_INSTRUCTIONS}\n\nTexto de la factura:\n${pdfText}`;
    } else {
      throw new Error(`Formato no soportado para extracción: ${mimeType}`);
    }

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
        input,
        maxOutputTokens: 700,
      },
    );

    if (!response.ok) {
      throw new Error(response.summary || "El proveedor de IA no pudo procesar la factura.");
    }

    const data = parseJsonObject(response.outputText);
    return mapFields(data, isImageMime(mimeType) ? "" : pdfText);
  };

  return { extract };
};

export type InvoiceExtractionService = ReturnType<typeof createInvoiceExtractionService>;
