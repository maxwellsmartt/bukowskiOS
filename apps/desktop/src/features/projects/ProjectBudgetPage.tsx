import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Pencil, Plus, Save, X } from "lucide-react";

import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useFinanceEntries } from "@features/finance/useFinanceData";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { HelpHint } from "@shared/components/HelpHint";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
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

const formatCurrency = (value: number, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
};

export const ProjectBudgetPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { supabase, isLocalFallback } = useSession();
  const { activeWorkspaceId } = useWorkspace();
  const { projectId } = useProjectMode();
  const { data, error, isLoading } = useProjectDetail(projectId);
  const { data: financeEntries, error: financeError } = useFinanceEntries({
    search: "",
    sortBy: "date",
    sortDirection: "desc",
  });

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
        toast.success("Target cleared", "This project no longer has a budget target.");
      } catch (nextError) {
        toast.error("Could not clear target", getUserFacingErrorMessage(nextError, "Try again in a moment."));
      } finally {
        setIsSavingTarget(false);
      }
      return;
    }

    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Invalid number", "Enter a positive amount or leave the field empty to clear the target.");
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
        "Budget target saved",
        cloudEnabled ? "Synced to the cloud — visible to teammates." : "Saved locally; cloud sync resumes when you reconnect.",
      );
    } catch (nextError) {
      // If cloud failed, still keep local copy.
      writeBudgetTarget(projectId, parsed);
      setBudgetTarget(parsed);
      setIsEditingTarget(false);
      toast.error(
        "Saved locally — cloud failed",
        getUserFacingErrorMessage(nextError, "We kept your value on this device. We'll retry on next sync."),
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
    return <div className="empty-state">Project budget unavailable: {error}</div>;
  }

  if (isLoading) {
    return (
      <SurfaceCard title="Budget">
        <TableSkeleton body="Loading budget details." columns={4} />
      </SurfaceCard>
    );
  }

  if (!data.project) {
    return <div className="empty-state">Select a project to review its budget.</div>;
  }

  const showEntriesEmpty = !financeError && projectEntries.length === 0;

  const targetUsage = budgetTarget && budgetTarget > 0 ? Math.min(1, totals.expense / budgetTarget) : 0;
  const remainingTarget = budgetTarget ? budgetTarget - totals.expense : 0;
  const overTarget = budgetTarget != null && totals.expense > budgetTarget;

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader title="Budget" />

      <div className="project-workspace-scroll">
        <SurfaceCard
          className="project-scroll-card"
          title="Budget target"
          aside={
            !isEditingTarget ? (
              <div className="surface-card-actions">
                <HelpHint
                  body={
                    cloudEnabled
                      ? "Synced to the cloud and visible to teammates with project access. Track how close you are to your planned spend."
                      : "Saved on this device while offline. Will sync to the cloud automatically when you reconnect."
                  }
                />
                <button className="ghost-control" onClick={() => setIsEditingTarget(true)} type="button">
                  <Pencil size={13} />
                  <span>{budgetTarget != null ? "Update target" : "Set target"}</span>
                </button>
              </div>
            ) : null
          }
        >
          {isEditingTarget ? (
            <div className="agent-form-grid">
              <label className="field-block">
                <span className="field-label">Target amount ({currency})</span>
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
                  <span>Cancel</span>
                </button>
                <button
                  className="action-primary-button"
                  disabled={isSavingTarget}
                  onClick={() => void handleSaveTarget()}
                  type="button"
                >
                  <Save size={13} />
                  <span>{isSavingTarget ? "Saving…" : "Save target"}</span>
                </button>
              </div>
            </div>
          ) : budgetTarget != null ? (
            <>
              <div className="project-budget-grid">
                <div className="summary-row">
                  <span className="summary-label">Target</span>
                  <span className="summary-value">{formatCurrency(budgetTarget, currency)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Spent</span>
                  <span className="summary-value">{formatCurrency(totals.expense, currency)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{overTarget ? "Over by" : "Remaining"}</span>
                  <span className="summary-value">
                    {formatCurrency(Math.abs(remainingTarget), currency)}
                  </span>
                </div>
              </div>
              <div
                aria-label={`Budget usage ${(targetUsage * 100).toFixed(0)} percent`}
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
              No target set yet. Click <strong>Set target</strong> to declare what this project should cap at.
            </p>
          )}
        </SurfaceCard>

        <div className="project-detail-support-grid">
          <SurfaceCard className="project-scroll-card" title="Budget summary">
            <div className="project-budget-grid">
              <div className="summary-row">
                <span className="summary-label">Total entries</span>
                <span className="summary-value">{data.budget.totalEntries}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Reserve</span>
                <span className="summary-value">{data.budget.reserve}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Exposure</span>
                <span className="summary-value">{data.budget.exposure}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Status</span>
                <span className="summary-value">{data.budget.status}</span>
              </div>
            </div>
            <p className="surface-card-subtitle project-budget-note">{data.budget.note}</p>
          </SurfaceCard>

          <SurfaceCard className="project-scroll-card" title="Spend breakdown">
            <div className="project-budget-grid">
              <div className="summary-row">
                <span className="summary-label">Logged income</span>
                <span className="summary-value">{formatCurrency(totals.income, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Logged expense</span>
                <span className="summary-value">{formatCurrency(totals.expense, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Net</span>
                <span className="summary-value">{formatCurrency(netExposure, currency)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Entries on this project</span>
                <span className="summary-value">{projectEntries.length}</span>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard
          className="project-scroll-card"
          aside={
            <div className="surface-card-actions">
              <button className="ghost-control" onClick={() => navigate("/finance/entries")} type="button">
                <ArrowUpRight size={14} />
                <span>Open finance</span>
              </button>
              <button className="action-primary-button" onClick={() => navigate("/finance/entries")} type="button">
                <Plus size={14} />
                <span>Add entry</span>
              </button>
            </div>
          }
          title="Finance entries"
        >
          {financeError ? <div className="action-feedback action-feedback-error">{financeError}</div> : null}
          {showEntriesEmpty ? (
            <GuidedEmptyState
              title="No finance entries yet"
              body="Once you log purchases, rentals or invoices against this project they appear here. Add the first one from the Finance section."
              actionLabel="Add finance entry"
              onAction={() => navigate("/finance/entries")}
              tone="subtle"
            />
          ) : (
            <DataTable
              columns={[
                { key: "date", label: "Date", render: (row) => row.date },
                { key: "type", label: "Type", render: (row) => row.type },
                { key: "category", label: "Category", render: (row) => row.category },
                { key: "reference", label: "Reference", render: (row) => row.reference },
                { key: "amount", label: "Amount", align: "right", render: (row) => row.amount },
                { key: "status", label: "Status", render: (row) => row.status },
              ]}
              getRowId={(row) => row.id}
              maxHeight="min(40vh, 360px)"
              persistKey="project-budget-finance-entries"
              rows={projectEntries}
              onRowClick={(row) => navigate(`/finance/entries?focus=${encodeURIComponent(row.id)}`)}
            />
          )}
        </SurfaceCard>

        <SurfaceCard className="project-scroll-card" title="Cost-bearing incidents">
          <DataTable
            columns={[
              {
                key: "incident",
                label: "Incident",
                width: 260,
                minWidth: 190,
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.title}</span>
                    <span className="identity-meta">{row.asset}</span>
                  </div>
                ),
              },
              { key: "responsible", label: "Responsible", width: 160, minWidth: 128, render: (row) => row.responsible },
              { key: "severity", label: "Severity", width: 100, minWidth: 88, render: (row) => row.severity },
              { key: "costEstimate", label: "Estimate", align: "right", width: 120, minWidth: 100, render: (row) => row.costEstimate },
              { key: "status", label: "Status", width: 110, minWidth: 92, render: (row) => row.status },
            ]}
            getRowId={(row) => row.id}
            maxHeight="min(40vh, 360px)"
            persistKey="project-budget-incidents"
            rows={data.incidents}
            emptyMessage="No cost-bearing incidents yet."
          />
        </SurfaceCard>
      </div>
    </div>
  );
};
