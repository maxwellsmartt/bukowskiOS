import { useState } from "react";

import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useFinanceOverview } from "./useFinanceData";

export const FinanceOverviewPage = () => {
  const { data, error } = useFinanceOverview();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  return (
    <div className="page-stack">
      <SectionHeader title="Finance" />

      {error ? <div className="empty-state">Finance overview unavailable: {error}</div> : null}

      <div className="finance-grid">
        {data.metrics.map((metric) => (
          <SurfaceCard key={metric.label}>
            <span className={`metric-value metric-tone-${metric.tone}`}>{metric.value}</span>
            <p className="metric-label">{metric.label}</p>
          </SurfaceCard>
        ))}
      </div>

      <div className="split-layout">
        <SurfaceCard title="Exposure by project">
          <DataTable
            getRowId={(row) => row.project}
            maxHeight="min(48vh, 520px)"
            persistKey="finance-project-exposure"
            columns={[
              { key: "project", label: "Project", render: (row) => row.project },
              { key: "exposure", label: "Exposure", render: (row) => row.exposure },
              { key: "assetsOut", label: "Assets out", render: (row) => row.assetsOut },
              { key: "incidentCount", label: "Incidents", align: "right", render: (row) => row.incidentCount },
            ]}
            rows={data.exposureByProject}
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        <SurfaceCard title="Cost-link queue">
          <div className="queue-list">
            {data.costLinks.map((row) => (
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
};
