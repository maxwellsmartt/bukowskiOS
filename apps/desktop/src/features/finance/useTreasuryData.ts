import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AnnotateTransactionCommand,
  ApplyCounterpartyRuleCommand,
  ApplyCounterpartyRuleResult,
  AppExportResult,
  BankAccountRow,
  BankStatementImportRow,
  BankTransactionRow,
  CorrectTransactionCommand,
  CounterpartyRulePreview,
  CounterpartyRulePreviewQuery,
  ImportStatementCommand,
  LinkTransactionCommand,
  ProjectPnlRow,
  ReviewQueueRow,
  ReviewReimbursementCommand,
  SetAllocationsCommand,
  DgiiReport,
  DgiiReportExportInput,
  DgiiReportQuery,
  TreasuryDeductibleLedger,
  TreasuryDeductibleLedgerExportInput,
  TreasuryDeductibleLedgerQuery,
  TransactionMutationResult,
  TreasuryOverviewQuery,
  TreasuryOverviewSnapshot,
  TreasuryTransactionListQuery,
  TreasuryUndoPreview,
  UndoTreasuryActionCommand,
  UpsertBankAccountCommand,
  ApplyInvoiceExtractionCommand,
  BulkLinkInvoiceExtractionsCommand,
  DismissInvoiceExtractionCommand,
  EnqueueInvoiceBatchCommand,
  InvoiceExtraction,
  RetryInvoiceExtractionsCommand,
  UpdateInvoiceExtractionCommand,
} from "@contracts";
import { useWorkspaceDataRefreshVersion } from "@shared/hooks/useWorkspaceDataRefresh";

const emptyAccounts: BankAccountRow[] = [];
const emptyTransactions: BankTransactionRow[] = [];

export const useBankAccounts = (workspaceId: string) => {
  const [data, setData] = useState<BankAccountRow[]>(emptyAccounts);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !workspaceId) {
      setData(emptyAccounts);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiTreasury
      .listAccounts(workspaceId)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load accounts.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version, refreshVersion]);

  return { data, isLoading, error, refresh };
};

export const useTreasuryTransactions = (query: TreasuryTransactionListQuery) => {
  const [data, setData] = useState<BankTransactionRow[]>(emptyTransactions);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !query.workspaceId) {
      setData(emptyTransactions);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiTreasury
      .listTransactions(query)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load transactions.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    query.workspaceId,
    query.bankAccountId,
    query.dateFrom,
    query.dateTo,
    query.kind,
    query.direction,
    query.projectId,
    query.unclassifiedOnly,
    query.pendingReviewOnly,
    query.search,
    query.limit,
    version,
    refreshVersion,
  ]);

  return { data, isLoading, error, refresh };
};

export const useTreasuryOverview = (query: TreasuryOverviewQuery) => {
  const [data, setData] = useState<TreasuryOverviewSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !query.workspaceId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiTreasury
      .overview(query)
      .then((snapshot) => {
        if (!cancelled) setData(snapshot);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load overview.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query.workspaceId, query.period, query.customStartDate, query.customEndDate, query.reportCurrency, version, refreshVersion]);

  return { data, isLoading, error, refresh };
};

export const exportTreasuryOverviewPdf = async (query: TreasuryOverviewQuery): Promise<AppExportResult> => {
  if (!window.bukowskiTreasury) {
    throw new Error("Treasury bridge unavailable");
  }
  return window.bukowskiTreasury.exportOverviewPdf(query);
};

export const useTreasuryImports = (workspaceId: string, bankAccountId?: string) => {
  const [data, setData] = useState<BankStatementImportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !workspaceId) {
      setData([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    window.bukowskiTreasury
      .listImports(workspaceId, bankAccountId)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, bankAccountId, version, refreshVersion]);

  return { data, isLoading, refresh };
};

export const useInvoiceDuplicates = (workspaceId: string) => {
  const [data, setData] = useState<import("@contracts").InvoiceDuplicateGroup[]>([]);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !workspaceId) {
      setData([]);
      return;
    }
    let cancelled = false;
    // Backfill content hashes (older / pulled rows) before grouping, then list.
    void window.bukowskiTreasury
      .invoiceInboxBackfillHashes(workspaceId)
      .catch(() => 0)
      .then(() => window.bukowskiTreasury?.invoiceInboxDuplicates(workspaceId))
      .then((groups) => {
        if (!cancelled && groups) setData(groups);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version, refreshVersion]);

  return { data, refresh };
};

export const useExpenseCategories = (workspaceId: string) => {
  const [data, setData] = useState<string[]>([]);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  useEffect(() => {
    if (!window.bukowskiTreasury || !workspaceId) {
      setData([]);
      return;
    }
    let cancelled = false;
    void window.bukowskiTreasury
      .listExpenseCategories(workspaceId)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshVersion]);

  return data;
};

export const useReviewQueue = (workspaceId: string) => {
  const [data, setData] = useState<ReviewQueueRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !workspaceId) {
      setData([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    window.bukowskiTreasury
      .reviewQueue(workspaceId)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load review queue.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version, refreshVersion]);

  return { data, isLoading, error, refresh };
};

export const useInvoiceInbox = (workspaceId: string, includeResolved = false) => {
  const [data, setData] = useState<InvoiceExtraction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !workspaceId) {
      setData([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    window.bukowskiTreasury
      .invoiceInboxList({ workspaceId, includeResolved })
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load invoice inbox.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, includeResolved, version, refreshVersion]);

  return { data, isLoading, error, refresh };
};

export const useProjectPnl = (workspaceId: string, dateFrom?: string, dateTo?: string) => {
  const [data, setData] = useState<ProjectPnlRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  useEffect(() => {
    if (!window.bukowskiTreasury || !workspaceId) {
      setData([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    window.bukowskiTreasury
      .projectPnl(workspaceId, dateFrom, dateTo)
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, dateFrom, dateTo, refreshVersion]);

  return { data, isLoading };
};

export const useTreasuryUndoPreview = (workspaceId: string) => {
  const [data, setData] = useState<TreasuryUndoPreview>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !workspaceId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    window.bukowskiTreasury
      .undoPreview(workspaceId)
      .then((preview) => {
        if (!cancelled) setData(preview);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version, refreshVersion]);

  return { data, isLoading, refresh };
};

export const useTreasuryDeductibleLedger = (query: TreasuryDeductibleLedgerQuery) => {
  const [data, setData] = useState<TreasuryDeductibleLedger | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshVersion = useWorkspaceDataRefreshVersion();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!window.bukowskiTreasury || !query.workspaceId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiTreasury
      .deductibleLedger(query)
      .then((ledger) => {
        if (!cancelled) setData(ledger);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load deductible ledger.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query.workspaceId, query.period, query.customStartDate, query.customEndDate, version, refreshVersion]);

  return { data, isLoading, error, refresh };
};

export const useTreasuryMutations = () =>
  useMemo(
    () => ({
      async upsertAccount(input: UpsertBankAccountCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.upsertAccount(input);
      },
      async importStatement(input: ImportStatementCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.importStatement(input);
      },
      async previewClassificationRule(input: CounterpartyRulePreviewQuery): Promise<CounterpartyRulePreview> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.previewClassificationRule(input);
      },
      async addManualTransactions(input: ImportStatementCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.addManualTransactions(input);
      },
      async deleteImport(input: { commandId: string; workspaceId: string; actorType: "user"; sourceChannel: "desktop"; importId: string }) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.deleteImport(input);
      },
      async correctTransaction(input: CorrectTransactionCommand): Promise<TransactionMutationResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.correctTransaction(input);
      },
      async annotate(input: AnnotateTransactionCommand): Promise<TransactionMutationResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.annotateTransaction(input);
      },
      async applyClassificationRule(input: ApplyCounterpartyRuleCommand): Promise<ApplyCounterpartyRuleResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.applyClassificationRule(input);
      },
      async setAllocations(input: SetAllocationsCommand): Promise<TransactionMutationResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.setAllocations(input);
      },
      async reviewReimbursement(input: ReviewReimbursementCommand): Promise<TransactionMutationResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.reviewReimbursement(input);
      },
      async linkTransaction(input: LinkTransactionCommand): Promise<TransactionMutationResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.linkTransaction(input);
      },
      async undoLastAction(input: UndoTreasuryActionCommand): Promise<TransactionMutationResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.undoLastAction(input);
      },
      async exportDeductibleLedger(input: TreasuryDeductibleLedgerExportInput): Promise<AppExportResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.exportDeductibleLedger(input);
      },
      async exportDgiiReport(input: DgiiReportExportInput): Promise<AppExportResult> {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.exportDgiiReport(input);
      },
      async enqueueInvoices(input: EnqueueInvoiceBatchCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.invoiceInboxEnqueue(input);
      },
      async updateInvoiceExtraction(input: UpdateInvoiceExtractionCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.invoiceInboxUpdate(input);
      },
      async bulkLinkInvoices(input: BulkLinkInvoiceExtractionsCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.invoiceInboxBulkLink(input);
      },
      async retryInvoiceExtractions(input: RetryInvoiceExtractionsCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.invoiceInboxRetry(input);
      },
      async previewInvoiceDocument(workspaceId: string, extractionId: string) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.invoiceInboxPreview(workspaceId, extractionId);
      },
      async applyInvoiceExtraction(input: ApplyInvoiceExtractionCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.invoiceInboxApply(input);
      },
      async dismissInvoiceExtraction(input: DismissInvoiceExtractionCommand) {
        if (!window.bukowskiTreasury) throw new Error("Treasury bridge unavailable.");
        return window.bukowskiTreasury.invoiceInboxDismiss(input);
      },
    }),
    [],
  );
