import { ArrowUpRight, ShieldAlert, Wrench } from "lucide-react";

import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useOverviewSnapshot } from "./useOverviewSnapshot";

const queueCards = [
  {
    title: "Overdue returns",
    subtitle: "3 slips need attention before warehouse close.",
    icon: ArrowUpRight,
    tone: "warning" as const,
  },
  {
    title: "Active incidents",
    subtitle: "9 open incidents with 3 still missing cost estimates.",
    icon: ShieldAlert,
    tone: "critical" as const,
  },
  {
    title: "Maintenance watch",
    subtitle: "12 assets flagged for bench review or spare-part follow-up.",
    icon: Wrench,
    tone: "success" as const,
  },
];

export const OverviewPage = () => (
  <OverviewContent />
);

const OverviewContent = () => {
  const { data, error, isLoading } = useOverviewSnapshot();

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="InventoryOps v1"
        title="Operational clarity over warehouse, set and return flows"
        body="The shell prioritizes fast readability, current exposure and event-driven follow-up without falling into a crowded admin-dashboard layout."
      />

      {error ? <div className="empty-state">Overview unavailable: {error}</div> : null}

      <div className="metric-grid">
        {data.metrics.map((metric) => (
          <SurfaceCard key={metric.label}>
            <span className={`metric-value metric-tone-${metric.tone}`}>{metric.value}</span>
            <p className="metric-label">{metric.label}</p>
          </SurfaceCard>
        ))}
        {!data.metrics.length && isLoading ? (
          <SurfaceCard>
            <p className="metric-label">Loading local workspace metrics...</p>
          </SurfaceCard>
        ) : null}
      </div>

      <div className="queue-grid">
        {queueCards.map((card) => {
          const Icon = card.icon;
          return (
            <SurfaceCard key={card.title} title={card.title} subtitle={card.subtitle} aside={<Icon size={16} />}>
              <StatusBadge tone={card.tone}>{card.tone}</StatusBadge>
            </SurfaceCard>
          );
        })}
      </div>

      <SurfaceCard
        title="Recent movements"
        subtitle="This list should stay compact, current and directly useful for supervisors and warehouse staff."
      >
        <DataTable
          columns={[
            {
              key: "asset",
              label: "Asset",
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.asset}</span>
                  <span className="identity-meta">{row.code}</span>
                </div>
              ),
            },
            { key: "from", label: "From", render: (row) => row.from },
            { key: "to", label: "To", render: (row) => row.to },
            { key: "actor", label: "Handled by", render: (row) => row.actor },
            { key: "time", label: "Time", align: "right", render: (row) => row.timestamp },
          ]}
          rows={data.recentMovements}
        />
      </SurfaceCard>
    </div>
  );
};
