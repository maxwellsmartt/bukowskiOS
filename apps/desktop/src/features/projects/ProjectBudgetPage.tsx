import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Plus } from "lucide-react";

import { useFinanceEntries } from "@features/finance/useFinanceData";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";

import { useProjectMode } from "./useProjectMode";
import { useProjectDetail } from "./useProjectsData";

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
  const { projectId } = useProjectMode();
  const { data, error, isLoading } = useProjectDetail(projectId);
  const { data: financeEntries, error: financeError } = useFinanceEntries({
    search: "",
    sortBy: "date",
    sortDirection: "desc",
  });

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

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader
        title="Budget"
        body="Money flowing through this project. A target budget editor is coming soon."
      />

      <div className="project-workspace-scroll">
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
