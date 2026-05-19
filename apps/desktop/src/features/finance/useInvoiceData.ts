import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CancelInvoiceCommand,
  CreateInvoiceCommand,
  InvoiceDetail,
  InvoiceListFilter,
  InvoiceMutationResult,
  InvoiceRow,
  IssueInvoiceCommand,
  RecordInvoicePaymentCommand,
  UpdateInvoiceCommand,
} from "@contracts";
import { useWorkspaceDataRefreshVersion } from "@shared/hooks/useWorkspaceDataRefresh";

const emptyInvoices: InvoiceRow[] = [];

export const useInvoicesList = (filter: InvoiceListFilter) => {
  const [data, setData] = useState<InvoiceRow[]>(emptyInvoices);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiInvoices || !filter.workspaceId) {
      setData(emptyInvoices);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiInvoices
      .list(filter)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load invoices.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    filter.workspaceId,
    filter.status,
    filter.clientId,
    filter.projectId,
    filter.dateFrom,
    filter.dateTo,
    filter.currency,
    filter.search,
    filter.hasOutstanding,
    filter.limit,
    version,
    refreshVersion,
  ]);

  return { data, isLoading, error, refresh };
};

export const useInvoiceDetail = (
  workspaceId: string,
  invoiceId: string | null | undefined,
) => {
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiInvoices || !workspaceId || !invoiceId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiInvoices
      .detail(workspaceId, invoiceId)
      .then((row) => {
        if (!cancelled) setData(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load invoice.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, invoiceId, version, refreshVersion]);

  return { data, isLoading, error, refresh };
};

export const useInvoiceMutations = () =>
  useMemo(
    () => ({
      async createInvoice(input: CreateInvoiceCommand): Promise<InvoiceMutationResult> {
        if (!window.bukowskiInvoices) throw new Error("Invoices bridge unavailable.");
        return window.bukowskiInvoices.create(input);
      },
      async updateInvoice(input: UpdateInvoiceCommand): Promise<InvoiceMutationResult> {
        if (!window.bukowskiInvoices) throw new Error("Invoices bridge unavailable.");
        return window.bukowskiInvoices.update(input);
      },
      async issueInvoice(input: IssueInvoiceCommand): Promise<InvoiceMutationResult> {
        if (!window.bukowskiInvoices) throw new Error("Invoices bridge unavailable.");
        return window.bukowskiInvoices.issue(input);
      },
      async cancelInvoice(input: CancelInvoiceCommand): Promise<InvoiceMutationResult> {
        if (!window.bukowskiInvoices) throw new Error("Invoices bridge unavailable.");
        return window.bukowskiInvoices.cancel(input);
      },
      async recordPayment(input: RecordInvoicePaymentCommand): Promise<InvoiceMutationResult> {
        if (!window.bukowskiInvoices) throw new Error("Invoices bridge unavailable.");
        return window.bukowskiInvoices.recordPayment(input);
      },
      async createFromQuote(input: {
        workspaceId: string;
        quoteId: string;
        commandId: string;
      }): Promise<InvoiceMutationResult> {
        if (!window.bukowskiInvoices) throw new Error("Invoices bridge unavailable.");
        return window.bukowskiInvoices.createFromQuote(input);
      },
    }),
    [],
  );
