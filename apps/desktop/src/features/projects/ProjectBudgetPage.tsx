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

const readBudgetTarget = (projectId: string | null): number | null => {
  if (!projectId || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(buildBudgetTargetKey(projectId));
    if (!raw) {
      return null;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeBudgetTarget = (projectId: string, value: number | null) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value == null) {
      window.localStorage.removeItem(buildBudgetTargetKey(projectId));
    } else {
      window.localStorage.setItem(buildBudgetTargetKey(projectId), String(value));
    }
  } catch {
    // ignore storage errors
  }
};

const sumEntriesByType = (rows: Array<{ type: string; amountValue?: number }>) => {
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

export const ProjectBudgetPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { supabase, isLocalFallback } = useSession();
  const { activeWorkspaceId } = useWorkspace();
  const { formatMoney } = useLocale();
  const formatCurrency = (value: number, code = "USD") =>
    formatMoney(value, code, { maximumFractionDigits: 0 });
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
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");
  const [isSavingTarget, setIsSavingTarget] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const localValue = readBudgetTarget(projectId);
    setBudgetTarget(localValue);
    setTargetDraft(localValue != null ? String(localValue) : "");

    if (!cloudEnabled || !supabase || !projectId) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const remote = await fetchProjectBudgetTarget(supabase, projectId);
        if (cancelled) return;
        if (remote) {
          setBudgetTarget(remote.amount);
          setTargetDraft(String(remote.amount));
          writeBudgetTarget(projectId, remote.amount); // mirror locally for offline fallback
        } else {
          // remote authoritative: if no remote target, clear local mirror
          setBudgetTarget(null);
          setTargetDraft("");
          writeBudgetTarget(projectId, null);
        }
      } catch {
        // Silently keep local fallback when remote is unreachable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cloudEnabled, projectId, supabase]);

  const handleSaveTarget = async () => {
    if (!projectId) return;
    const trimmed = targetDraft.trim();

    if (!trimmed) {
      setIsSavingTarget(true);
      try {
        if (cloudEnabled && supabase) {
          await deleteProjectBudgetTarget(supabase, projectId);
        }
        writeBudgetTarget(projectId, null);
        setBudgetTarget(null);
        setIsEditingTarget(false);
        toast.success(t("projects.budget.toasts.targetClearedTitle"), t("projects.budget.toasts.targetClearedBody"));
      } catch (nextError) {
        toast.error(t("projects.budget.toasts.clearFailed"), getUserFacingErrorMessage(nextError, t("common.tryAgain")));
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
    try {
      if (cloudEnabled && supabase) {
        await upsertProjectBudgetTarget(supabase, {
          projectId,
          workspaceId: activeWorkspaceId,
          amount: parsed,
          currency: "USD",
        });
      }
      writeBudgetTarget(projectId, parsed);
      setBudgetTarget(parsed);
      setIsEditingTarget(false);
      toast.success(
        t("projects.budget.toasts.targetSavedTitle"),
        cloudEnabled ? t("projects.budget.toasts.targetSavedCloud") : t("projects.budget.toasts.targetSavedLocal"),
      );
    } catch (nextError) {
      // If cloud failed, still keep local copy.
      writeBudgetTarget(projectId, parsed);
      setBudgetTarget(parsed);
      setIsEditingTarget(false);
      toast.error(
        t("projects.budget.toasts.cloudFailedTitle"),
        getUserFacingErrorMessage(nextError, t("projects.budget.toasts.cloudFailedBody")),
      );
    } finally {
      setIsSavingTarget(false);
    }
  };

  const projectEntries = useMemo(
    () => (projectId ? financeEntries.filter((entry) => entry.projectId === projectId) : []),
    [financeEntries, projectId],
  );

  const totals = useMemo(() => sumEntriesByType(projectEntries), [projectEntries]);
  const netExposure = totals.expense - totals.income;
  const currency = projectEntries[0]?.currency ?? "USD";

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

  const targetUsage = budgetTarget && budgetTarget > 0 ? Math.min(1, totals.expense / budgetTarget) : 0;
  const remainingTarget = budgetTarget ? budgetTarget - totals.expense : 0;
  const overTarget = budgetTarget != null && totals.expense > budgetTarget;

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
                <span className="field-label">{t("projects.budget.target.amount", { currency })}</span>
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
              <div className="project-budget-grid">
                <div className="summary-row">
                  <span className="summary-label">{t("projects.budget.target.target")}</span>
                  <span className="summary-value">{formatCurrency(budgetTarget, currency)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("projects.budget.target.spent")}</span>
                  <span className="summary-value">{formatCurrency(totals.expense, currency)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{overTarget ? t("projects.budget.target.overBy") : t("projects.budget.target.remaining")}</span>
                  <span className="summary-value">
                    {formatCurrency(Math.abs(remainingTarget), currency)}
                  </span>
                </div>
              </div>
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
            </>
          ) : (
            <p className="surface-card-subtitle">
              {t("projects.budget.target.noTargetPrefix")} <strong>{t("projects.budget.target.set")}</strong> {t("projects.budget.target.noTargetSuffix")}
            </p>
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
                <span className="summary-value">{formatCurrency(totals.income, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.spend.loggedExpense")}</span>
                <span className="summary-value">{formatCurrency(totals.expense, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.spend.net")}</span>
                <span className="summary-value">{formatCurrency(netExposure, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("projects.budget.spend.entriesOnProject")}</span>
                <span className="summary-value">{projectEntries.length}</span>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="project-scroll-card" title="Honorarios de crew">
            <div className="project-budget-grid">
              <div className="summary-row">
                <span className="summary-label">Pendiente</span>
                <span className="summary-value">{formatCurrency(collaboratorSummary.pendingAmount, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Aprobado</span>
                <span className="summary-value">{formatCurrency(collaboratorSummary.approvedAmount, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Pagado este mes</span>
                <span className="summary-value">{formatCurrency(collaboratorSummary.paidThisMonth, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Con balance</span>
                <span className="summary-value">{collaboratorSummary.collaboratorsWithBalance}</span>
              </div>
            </div>
            <div className="surface-card-actions" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="ghost-control" onClick={() => navigate("/finance/collaborators")} type="button">
                <ArrowUpRight size={14} />
                <span>Abrir honorarios</span>
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
              <button className="action-primary-button" onClick={() => navigate("/finance/entries")} type="button">
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
          />
        </SurfaceCard>
      </div>
    </div>
  );
};
