import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CreateQuoteCommand,
  DuplicateQuoteCommand,
  QuoteDetail,
  QuoteListFilter,
  QuoteMutationResult,
  QuoteRow,
  SetQuoteStatusCommand,
  UpdateQuoteCommand,
} from "@contracts";

const emptyQuotes: QuoteRow[] = [];

export const useQuotesList = (filter: QuoteListFilter) => {
  const [data, setData] = useState<QuoteRow[]>(emptyQuotes);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiQuotes || !filter.workspaceId) {
      setData(emptyQuotes);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiQuotes
      .list(filter)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load quotes.");
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
    filter.limit,
    version,
  ]);

  return { data, isLoading, error, refresh };
};

export const useQuoteDetail = (workspaceId: string, quoteId: string | null | undefined) => {
  const [data, setData] = useState<QuoteDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiQuotes || !workspaceId || !quoteId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiQuotes
      .detail(workspaceId, quoteId)
      .then((row) => {
        if (!cancelled) setData(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load quote.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, quoteId, version]);

  return { data, isLoading, error, refresh };
};

export type QuoteVersionRow = {
  id: string;
  versionNumber: number;
  changeSummary: string | null;
  createdAt: string;
  createdByUserId: string | null;
  snapshot: Record<string, unknown>;
};

export const useQuoteVersions = (workspaceId: string, quoteId: string | null | undefined) => {
  const [data, setData] = useState<QuoteVersionRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiQuotes || !workspaceId || !quoteId) {
      setData([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    window.bukowskiQuotes
      .listVersions(workspaceId, quoteId)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, quoteId, version]);

  return { data, isLoading, refresh };
};

export const useQuoteMutations = () =>
  useMemo(
    () => ({
      async createQuote(input: CreateQuoteCommand): Promise<QuoteMutationResult> {
        if (!window.bukowskiQuotes) throw new Error("Quotes bridge unavailable.");
        return window.bukowskiQuotes.create(input);
      },
      async updateQuote(input: UpdateQuoteCommand): Promise<QuoteMutationResult> {
        if (!window.bukowskiQuotes) throw new Error("Quotes bridge unavailable.");
        return window.bukowskiQuotes.update(input);
      },
      async setStatus(input: SetQuoteStatusCommand): Promise<QuoteMutationResult> {
        if (!window.bukowskiQuotes) throw new Error("Quotes bridge unavailable.");
        return window.bukowskiQuotes.setStatus(input);
      },
      async duplicateQuote(input: DuplicateQuoteCommand): Promise<QuoteMutationResult> {
        if (!window.bukowskiQuotes) throw new Error("Quotes bridge unavailable.");
        return window.bukowskiQuotes.duplicate(input);
      },
      async deleteQuote(input: DuplicateQuoteCommand): Promise<QuoteMutationResult> {
        if (!window.bukowskiQuotes) throw new Error("Quotes bridge unavailable.");
        return window.bukowskiQuotes.delete(input);
      },
    }),
    [],
  );
