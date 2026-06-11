import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Pencil, Plus, Save, X } from "lucide-react";

import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useCollaboratorFeeSummary, useFinanceEntries } from "@features/finance/useFinanceData";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { HelpHint } from "@shared/components/HelpHint";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useLocale } from "@shared/hooks/useLocale";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import {
  deleteProjectBudgetTarget,
  fetchProjectBudgetTarget,
  upsertProjectBudgetTarget,
} from "./projectBudgetService";
import { useProjectMode } from "./useProjectMode";
import { useProjectDetail } from "./useProjectsData";

const buildBudgetTargetKey = (projectId: string) => `bukowski:project-budget-target:${projectId}`;

type LocalBudgetTargetState = {
  amount: number | null;
  currency: string;
  updatedAt: string | null;
  pendingSync: boolean;
  deleted?: boolean;
  lastSyncError?: string | null;
};

type FinanceEntryLike = {
  type: string;
  amountValue?: number;
  currency?: string;
};

const getEntryCurrency = (row: { currency?: string }) => row.currency?.trim().toUpperCase() || "USD";

const normalizeBudgetCurrency = (currency?: string | null) => currency?.trim().toUpperCase() || "USD";

const parseBudgetTargetState = (raw: string | null): LocalBudgetTargetState | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalBudgetTargetState>;
    const amount = typeof parsed.amount === "number" && Number.isFinite(parsed.amount) ? parsed.amount : null;
    return {
      amount,
      currency: normalizeBudgetCurrency(parsed.currency),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      pendingSync: Boolean(parsed.pendingSync),
      deleted: Boolean(parsed.deleted),
      lastSyncError: typeof parsed.lastSyncError === "string" ? parsed.lastSyncError : null,
    };
  } catch {
    const legacyAmount = Number.parseFloat(raw);
    return Number.isFinite(legacyAmount)
      ? {
          amount: legacyAmount,
          currency: "USD",
          updatedAt: null,
          pendingSync: false,
          deleted: false,
          lastSyncError: null,
        }
      : null;
  }
};

const readBudgetTargetState = (projectId: string | null): LocalBudgetTargetState | null => {
  if (!projectId || typeof window === "undefined") {
    return null;
  }
  try {
    return parseBudgetTargetState(window.localStorage.getItem(buildBudgetTargetKey(projectId)));
  } catch {
    return null;
  }
};

const writeBudgetTargetState = (projectId: string, state: LocalBudgetTargetState | null) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (state == null) {
      window.localStorage.removeItem(buildBudgetTargetKey(projectId));
    } else {
      window.localStorage.setItem(buildBudgetTargetKey(projectId), JSON.stringify(state));
    }
  } catch {
    // ignore storage errors
  }
};

const isRemoteNewer = (remoteUpdatedAt: string | null, localUpdatedAt: string | null) => {
  if (!remoteUpdatedAt || !localUpdatedAt) {
    return Boolean(remoteUpdatedAt);
  }
  const remoteTime = Date.parse(remoteUpdatedAt);
  const localTime = Date.parse(localUpdatedAt);
  if (!Number.isFinite(remoteTime) || !Number.isFinite(localTime)) {
    return Boolean(remoteUpdatedAt);
  }
  return remoteTime >= localTime;
};

const sumEntriesByType = (rows: FinanceEntryLike[]) => {
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    const value = row.amountValue ?? 0;
    if (row.type.toLowerCase().includes("income")) {
      income += value;
    } else {
      expense += value;
    }
  }
  return { income, expense };
};

const buildCurrencyBreakdown = (rows: FinanceEntryLike[]) => {
  const totals = new Map<string, { income: number; expense: number }>();
  rows.forEach((row) => {
    const currency = getEntryCurrency(row);
    const current = totals.get(currency) ?? { income: 0, expense: 0 };
    const value = row.amountValue ?? 0;
    if (row.type.toLowerCase().includes("income")) {
      current.income += value;
    } else {
      current.expense += value;
    }
    totals.set(currency, current);
  });
  return totals;
};

export const ProjectBudgetPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { supabase, isLocalFallback } = useSession();
  const { activeWorkspaceId } = useWorkspace();
  const { formatMoney } = useLocale();
  const formatCurrency = (value: number, code = "USD") =>
    formatMoney(value, code, { maximumFractionDigits: 0 });
  const formatCurrencyBreakdown = (totalsByCurrency: Map<string, { income: number; expense: number }>, field: "income" | "expense" | "net") => {
    if (!totalsByCurrency.size) {
      return formatCurrency(0, "USD");
    }
    return Array.from(totalsByCurrency.entries())
      .sort(([leftCurrency], [rightCurrency]) => leftCurrency.localeCompare(rightCurrency))
      .map(([currencyCode, totalsForCurrency]) => {
        const value =
          field === "income"
            ? totalsForCurrency.income
            : field === "expense"
              ? totalsForCurrency.expense
              : totalsForCurrency.expense - totalsForCurrency.income;
        return formatCurrency(value, currencyCode);
      })
      .join(" / ");
  };
  const { projectId } = useProjectMode();
  const { data, error, isLoading } = useProjectDetail(projectId);
  const { data: financeEntries, error: financeError } = useFinanceEntries({
    search: "",
    sortBy: "date",
    sortDirection: "desc",
  });
  const { data: collaboratorSummary } = useCollaboratorFeeSummary(projectId);

  const cloudEnabled = Boolean(supabase) && !isLocalFallback;
  const [budgetTarget, setBudgetTarget] = useState<number | null>(null);
  const [budgetTargetCurrency, setBudgetTargetCurrency] = useState("USD");
  const [targetSyncState, setTargetSyncState] = useState<"synced" | "local" | "pending">("synced");
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");
  const [isSavingTarget, setIsSavingTarget] = useState(false);

  const projectEntries = useMemo(
    () => (projectId ? financeEntries.filter((entry) => entry.projectId === projectId) : []),
    [financeEntries, projectId],
  );

  const totalsByCurrency = useMemo(() => buildCurrencyBreakdown(projectEntries), [projectEntries]);
  const entryCurrencies = useMemo(() => Array.from(totalsByCurrency.keys()).sort(), [totalsByCurrency]);
  const hasMixedCurrencies = entryCurrencies.length > 1;
  const singleEntryCurrency = entryCurrencies[0] ?? budgetTargetCurrency;
  const displayCurrency = budgetTargetCurrency || singleEntryCurrency || "USD";
  const targetCurrencyMismatch = Boolean(budgetTarget != null && entryCurrencies.length === 1 && singleEntryCurrency !== displayCurrency);
  const canCompareBudgetTarget = budgetTarget != null && !hasMixedCurrencies && !targetCurrencyMismatch;
  const comparableEntries = projectEntries.filter((entry) => getEntryCurrency(entry) === displayCurrency);

  useEffect(() => {
    let cancelled = false;
    const localState = readBudgetTargetState(projectId);
    setBudgetTarget(localState?.deleted ? null : localState?.amount ?? null);
    setBudgetTargetCurrency(localState?.currency ?? singleEntryCurrency ?? "USD");
    setTargetDraft(!localState?.deleted && localState?.amount != null ? String(localState.amount) : "");
    setTargetSyncState(localState?.pendingSync ? "pending" : localState ? "local" : "synced");

    if (!cloudEnabled || !supabase || !projectId) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        let effectiveLocalState = localState;
        if (localState?.pendingSync) {
          if (localState.deleted) {
            await deleteProjectBudgetTarget(supabase, projectId);
            writeBudgetTargetState(projectId, null);
            effectiveLocalState = null;
            if (!cancelled) {
              setTargetSyncState("synced");
            }
          } else if (localState.amount != null) {
            await upsertProjectBudgetTarget(supabase, {
              projectId,
              workspaceId: activeWorkspaceId,
              amount: localState.amount,
              currency: localState.currency,
            });
            const syncedState = { ...localState, pendingSync: false, lastSyncError: null };
            writeBudgetTargetState(projectId, syncedState);
            effectiveLocalState = syncedState;
            if (!cancelled) {
              setBudgetTarget(syncedState.amount);
              setBudgetTargetCurrency(syncedState.currency);
              setTargetDraft(String(syncedState.amount));
              setTargetSyncState("synced");
            }
          }
        }

        const remote = await fetchProjectBudgetTarget(supabase, projectId);
        if (cancelled) return;
        if (remote) {
          if (effectiveLocalState?.pendingSync || (effectiveLocalState && !isRemoteNewer(remote.updatedAt, effectiveLocalState.updatedAt))) {
            setTargetSyncState(effectiveLocalState.pendingSync ? "pending" : "local");
            return;
          }
          setBudgetTarget(remote.amount);
          setBudgetTargetCurrency(remote.currency);
          setTargetDraft(String(remote.amount));
          writeBudgetTargetState(projectId, {
            amount: remote.amount,
            currency: remote.currency,
            updatedAt: remote.updatedAt,
            pendingSync: false,
            deleted: false,
            lastSyncError: null,
          });
          setTargetSyncState("synced");
        } else {
          if (effectiveLocalState && !effectiveLocalState.deleted) {
            setTargetSyncState(effectiveLocalState.pendingSync ? "pending" : "local");
            return;
          }
          writeBudgetTargetState(projectId, null);
          setTargetSyncState("synced");
        }
      } catch {
        if (!cancelled && localState) {
          setTargetSyncState(localState.pendingSync ? "pending" : "local");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, cloudEnabled, projectId, singleEntryCurrency, supabase]);

  const handleSaveTarget = async () => {
    if (!projectId) return;
    const trimmed = targetDraft.trim();

    if (!trimmed) {
      setIsSavingTarget(true);
      const updatedAt = new Date().toISOString();
      try {
        if (cloudEnabled && supabase) {
          await deleteProjectBudgetTarget(supabase, projectId);
        }
        writeBudgetTargetState(projectId, null);
        setBudgetTarget(null);
        setIsEditingTarget(false);
        setTargetSyncState("synced");
        toast.success(t("projects.budget.toasts.targetClearedTitle"), t("projects.budget.toasts.targetClearedBody"));
      } catch (nextError) {
        writeBudgetTargetState(projectId, {
          amount: null,
          currency: budgetTargetCurrency,
          updatedAt,
          pendingSync: true,
          deleted: true,
          lastSyncError: getUserFacingErrorMessage(nextError, t("common.tryAgain")),
        });
        setBudgetTarget(null);
        setIsEditingTarget(false);
        setTargetSyncState("pending");
        toast.error(t("projects.budget.toasts.clearFailed"), t("projects.budget.toasts.clearPendingBody"));
      } finally {
        setIsSavingTarget(false);
      }
      return;
    }

    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error(t("projects.budget.toasts.invalidNumberTitle"), t("projects.budget.toasts.invalidNumberBody"));
      return;
    }

    setIsSavingTarget(true);
    const updatedAt = new Date().toISOString();
    const currencyForTarget = displayCurrency;
    try {
      if (cloudEnabled && supabase) {
        await upsertProjectBudgetTarget(supabase, {
          projectId,
          workspaceId: activeWorkspaceId,
          amount: parsed,
          currency: currencyForTarget,
        });
      }
      writeBudgetTargetState(projectId, {
        amount: parsed,
        currency: currencyForTarget,
        updatedAt,
        pendingSync: false,
        deleted: false,
        lastSyncError: null,
      });
      setBudgetTarget(parsed);
      setBudgetTargetCurrency(currencyForTarget);
      setIsEditingTarget(false);
      setTargetSyncState(cloudEnabled ? "synced" : "local");
      toast.success(
        t("projects.budget.toasts.targetSavedTitle"),
        cloudEnabled ? t("projects.budget.toasts.targetSavedCloud") : t("projects.budget.toasts.targetSavedLocal"),
      );
    } catch (nextError) {
      const message = getUserFacingErrorMessage(nextError, t("projects.budget.toasts.cloudFailedBody"));
      writeBudgetTargetState(projectId, {
        amount: parsed,
        currency: currencyForTarget,
        updatedAt,
        pendingSync: true,
        deleted: false,
        lastSyncError: message,
      });
      setBudgetTarget(parsed);
      setBudgetTargetCurrency(currencyForTarget);
      setIsEditingTarget(false);
      setTargetSyncState("pending");
      toast.error(
        t("projects.budget.toasts.cloudFailedTitle"),
        message,
      );
    } finally {
      setIsSavingTarget(false);
    }
  };

  const totals = useMemo(() => sumEntriesByType(comparableEntries), [comparableEntries]);
  const netExposure = totals.expense - totals.income;

  if (error) {
    return <div className="empty-state">{t("projects.budget.unavailable", { message: error })}</div>;
  }

  if (isLoading) {
    return (
      <SurfaceCard title={t("projects.budget.title")}>
        <TableSkeleton body={t("projects.budget.loading")} columns={4} />
      </SurfaceCard>
    );
  }

  if (!data.project) {
    return <div className="empty-state">{t("projects.budget.emptyProject")}</div>;
  }

  const showEntriesEmpty = !financeError && projectEntries.length === 0;

  const targetUsage = canCompareBudgetTarget && budgetTarget > 0 ? Math.min(1, totals.expense / budgetTarget) : 0;
  const remainingTarget = canCompareBudgetTarget && budgetTarget ? budgetTarget - totals.expense : 0;
  const overTarget = canCompareBudgetTarget && budgetTarget != null && totals.expense > budgetTarget;
  const currencyWarning = hasMixedCurrencies
    ? t("projects.budget.currency.mixedWarning", { currencies: entryCurrencies.join(", ") })
    : targetCurrencyMismatch
      ? t("projects.budget.currency.targetMismatch", { targetCurrency: displayCurrency, entryCurrency: singleEntryCurrency })
      : null;

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader title={t("projects.budget.title")} />

      <div className="project-workspace-scroll">
        <SurfaceCard
          className="project-scroll-card"
          title={t("projects.budget.target.title")}
          aside={
            !isEditingTarget ? (
              <div className="surface-card-actions">
                <HelpHint
                  body={
                    cloudEnabled
                      ? t("projects.budget.target.cloudHelp")
                      : t("projects.budget.target.localHelp")
                  }
                />
                <button className="ghost-control" onClick={() => setIsEditingTarget(true)} type="button">
                  <Pencil size={13} />
                  <span>{budgetTarget != null ? t("projects.budget.target.update") : t("projects.budget.target.set")}</span>
                </button>
              </div>
            ) : null
          }
        >
          {isEditingTarget ? (
            <div className="agent-form-grid">
              <label className="field-block">
                <span className="field-label">{t("projects.budget.target.amount", { currency: displayCurrency })}</span>
                <input
                  className="field-input"
                  inputMode="decimal"
                  onChange={(event) => setTargetDraft(event.target.value)}
                  placeholder="50000"
                  value={targetDraft}
                />
              </label>
              <div className="surface-card-actions" style={{ gridColumn: "1 / -1", justifyContent: "flex-end" }}>
                <button
                  className="ghost-control"
                  disabled={isSavingTarget}
                  onClick={() => {
                    setIsEditingTarget(false);
                    setTargetDraft(budgetTarget != null ? String(budgetTarget) : "");
                  }}
                  type="button"
                >
                  <X size={13} />
                  <span>{t("common.cancel")}</span>
                </button>
                <button
                  className="action-primary-button"
                  disabled={isSavingTarget}
                  onClick={() => void handleSaveTarget()}
                  type="button"
                >
                  <Save size={13} />
                  <span>{isSavingTarget ? t("common.saving") : t("projects.budget.target.save")}</span>
                </button>
              </div>
            </div>
          ) : budgetTarget != null ? (
            <>
              {targetSyncState !== "synced" ? (
                <div className={`action-feedback ${targetSyncState === "pending" ? "action-feedback-warning" : "action-feedback-info"}`}>
                  {targetSyncState === "pending"
                    ? t("projects.budget.target.pendingSync")
                    : t("projects.budget.target.localOnly")}
                </div>
              ) : null}
              {currencyWarning ? <div className="action-feedback action-feedback-warning">{currencyWarning}</div> : null}
              <div className="project-budget-grid">
                <div className="summary-row">
                  <span className="summary-label">{t("projects.budget.target.target")}</span>
                  <span className="summary-value">{formatCurrency(budgetTarget, displayCurrency)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("projects.budget.target.spent")}</span>
                  <span className="summary-value">
                    {canCompareBudgetTarget
                      ? formatCurrency(totals.expense, displayCurrency)
                      : formatCurrencyBreakdown(totalsByCurrency, "expense")}
                  </span>
                </div>
                {canCompareBudgetTarget ? (
                  <div className="summary-row">
                    <span className="summary-label">{overTarget ? t("projects.budget.target.overBy") : t("projects.budget.target.remaining")}</span>
                    <span className="summary-value">{formatCurrency(Math.abs(remainingTarget), displayCurrency)}</span>
                  </div>
                ) : null}
              </div>
              {canCompareBudgetTarget ? (
                <div
                  aria-label={t("projects.budget.target.usageAria", { percent: (targetUsage * 100).toFixed(0) })}
                  className={`budget-progress${overTarget ? " is-over" : ""}`}
                  role="progressbar"
                  aria-valuenow={Math.round(targetUsage * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span className="budget-progress-fill" style={{ width: `${Math.round(targetUsage * 100)}%` }} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              {targetSyncState === "pending" ? (
                <div className="action-feedback action-feedback-warning">{t("projects.budget.target.pendingSync")}</div>
              ) : null}
              <p className="surface-card-subtitle">
                {t("projects.budget.target.noTargetPrefix")} <strong>{t("projects.budget.target.set")}</strong> {t("projects.budget.target.noTargetSuffix")}
              </p>
            </>
          )}
        </SurfaceCard>

        <div className="project-detail-support-grid">
          <SurfaceCard className="project-scroll-card" title={t("projects.budget.summary.title")}>
            <div className="project-budget-grid">
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.summary.totalEntries")}</span>
                <span className="summary-value">{data.budget.totalEntries}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.summary.reserve")}</span>
                <span className="summary-value">{data.budget.reserve}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.summary.exposure")}</span>
                <span className="summary-value">{data.budget.exposure}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.summary.status")}</span>
                <span className="summary-value">{data.budget.status}</span>
              </div>
            </div>
            <p className="surface-card-subtitle project-budget-note">{data.budget.note}</p>
          </SurfaceCard>

          <SurfaceCard className="project-scroll-card" title={t("projects.budget.spend.title")}>
            <div className="project-budget-grid">
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.spend.loggedIncome")}</span>
                <span className="summary-value">{formatCurrencyBreakdown(totalsByCurrency, "income")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.spend.loggedExpense")}</span>
                <span className="summary-value">{formatCurrencyBreakdown(totalsByCurrency, "expense")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.spend.net")}</span>
                <span className="summary-value">
                  {hasMixedCurrencies ? formatCurrencyBreakdown(totalsByCurrency, "net") : formatCurrency(netExposure, displayCurrency)}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.spend.entriesOnProject")}</span>
                <span className="summary-value">{projectEntries.length}</span>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="project-scroll-card" title={t("projects.budget.collaborators.title")}>
            <div className="project-budget-grid">
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.collaborators.pending")}</span>
                <span className="summary-value">{formatCurrency(collaboratorSummary.pendingAmount, displayCurrency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.collaborators.approved")}</span>
                <span className="summary-value">{formatCurrency(collaboratorSummary.approvedAmount, displayCurrency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.collaborators.paidThisMonth")}</span>
                <span className="summary-value">{formatCurrency(collaboratorSummary.paidThisMonth, displayCurrency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.collaborators.withBalance")}</span>
                <span className="summary-value">{collaboratorSummary.collaboratorsWithBalance}</span>
              </div>
            </div>
            <div className="surface-card-actions" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="ghost-control" onClick={() => navigate("/finance/collaborators")} type="button">
                <ArrowUpRight size={14} />
                <span>{t("projects.budget.collaborators.open")}</span>
              </button>
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard
          className="project-scroll-card"
          aside={
            <div className="surface-card-actions">
              <button className="ghost-control" onClick={() => navigate("/finance/entries")} type="button">
                <ArrowUpRight size={14} />
                <span>{t("projects.budget.finance.open")}</span>
              </button>
              <button
                className="action-primary-button"
                onClick={() =>
                  navigate(projectId ? `/finance/entries?new=1&projectId=${encodeURIComponent(projectId)}` : "/finance/entries")
                }
                type="button"
              >
                <Plus size={14} />
                <span>{t("projects.budget.finance.addEntry")}</span>
              </button>
            </div>
          }
          title={t("projects.budget.finance.title")}
        >
          {financeError ? <div className="action-feedback action-feedback-error">{financeError}</div> : null}
          {showEntriesEmpty ? (
            <GuidedEmptyState
              title={t("projects.budget.finance.emptyTitle")}
              body={t("projects.budget.finance.emptyBody")}
              actionLabel={t("projects.budget.finance.addFinanceEntry")}
              onAction={() => navigate("/finance/entries")}
              tone="subtle"
            />
          ) : (
            <DataTable
              columns={[
                { key: "date", label: t("projects.budget.finance.columns.date"), render: (row) => row.date },
                { key: "type", label: t("projects.budget.finance.columns.type"), render: (row) => row.type },
                { key: "category", label: t("projects.budget.finance.columns.category"), render: (row) => row.category },
                { key: "reference", label: t("projects.budget.finance.columns.reference"), render: (row) => row.reference },
                { key: "amount", label: t("projects.budget.finance.columns.amount"), align: "right", render: (row) => row.amount },
                { key: "status", label: t("projects.budget.finance.columns.status"), render: (row) => row.status },
              ]}
              getRowId={(row) => row.id}
              maxHeight="min(40vh, 360px)"
              persistKey="project-budget-finance-entries"
              rows={projectEntries}
              onRowClick={(row) => navigate(`/finance/entries?focus=${encodeURIComponent(row.id)}`)}
            />
          )}
        </SurfaceCard>

        <SurfaceCard className="project-scroll-card" title={t("projects.budget.incidents.title")}>
          <DataTable
            columns={[
              {
                key: "incident",
                label: t("projects.budget.incidents.columns.incident"),
                width: 260,
                minWidth: 190,
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.title}</span>
                    <span className="identity-meta">{row.asset}</span>
                  </div>
                ),
              },
              { key: "responsible", label: t("projects.budget.incidents.columns.responsible"), width: 160, minWidth: 128, render: (row) => row.responsible },
              {
                key: "severity",
                label: t("projects.budget.incidents.columns.severity"),
                width: 100,
                minWidth: 88,
                render: (row) => t(`incidents.severity.${row.severity}`, { defaultValue: row.severity }),
              },
              { key: "costEstimate", label: t("projects.budget.incidents.columns.estimate"), align: "right", width: 120, minWidth: 100, render: (row) => row.costEstimate },
              {
                key: "status",
                label: t("projects.budget.incidents.columns.status"),
                width: 110,
                minWidth: 92,
                render: (row) => t(`incidents.statuses.${row.status}`, { defaultValue: row.status }),
              },
            ]}
            getRowId={(row) => row.id}
            maxHeight="min(40vh, 360px)"
            persistKey="project-budget-incidents"
            rows={data.incidents}
            emptyMessage={t("projects.budget.incidents.empty")}
            onRowClick={(row) => {
              if (projectId) {
                navigate(`/projects/${projectId}/incidents?focus=${encodeURIComponent(row.id)}`);
              }
            }}
          />
        </SurfaceCard>
      </div>
    </div>
  );
};
