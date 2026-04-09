import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { financeCostLinks, financeExposureByProject, financeMetrics } from "@shared/lib/sample-data";

export const FinanceOverviewPage = () => (
  <div className="page-stack">
    <SectionHeader
      eyebrow="FinanceOps shell"
      title="Operational-financial visibility that already feels real from v1"
      body="FinanceOps is visible now because AssetOps should already expose replacement risk, incident exposure and linked cost context, even before full accounting workflows exist."
    />

    <div className="finance-grid">
      {financeMetrics.map((metric) => (
        <SurfaceCard key={metric.label}>
          <span className={`metric-value metric-tone-${metric.tone}`}>{metric.value}</span>
          <p className="metric-label">{metric.label}</p>
        </SurfaceCard>
      ))}
    </div>

    <div className="split-layout">
      <SurfaceCard title="Exposure by project" subtitle="Project scope and asset exposure should stay in the same conversation from day one.">
        <DataTable
          columns={[
            { key: "project", label: "Project", render: (row) => row.project },
            { key: "exposure", label: "Exposure", render: (row) => row.exposure },
            { key: "assetsOut", label: "Assets out", render: (row) => row.assetsOut },
            { key: "incidentCount", label: "Incidents", align: "right", render: (row) => row.incidentCount },
          ]}
          rows={financeExposureByProject}
        />
      </SurfaceCard>

      <SurfaceCard title="Cost-link queue" subtitle="This queue is the bridge between incidents, assets and future finance actions.">
        <div className="queue-list">
          {financeCostLinks.map((row) => (
            <div key={row.incident} className="queue-item">
              <div className="identity-cell">
                <span className="identity-title">{row.incident}</span>
                <span className="identity-meta">
                  {row.project} · {row.costEstimate}
                </span>
              </div>
              <StatusBadge tone={row.financialStatus === "Estimate missing" ? "warning" : "info"}>
                {row.financialStatus}
              </StatusBadge>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  </div>
);
