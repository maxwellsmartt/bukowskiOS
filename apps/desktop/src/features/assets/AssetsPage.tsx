import { Link } from "react-router-dom";

import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useAssetsList } from "./useAssetsData";

export const AssetsPage = () => <AssetsContent />;

const AssetsContent = () => {
  const { data: assets, error } = useAssetsList();
  const activeAsset = assets[0];

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Assets"
        title="Inventory"
        body="Live registry of equipment, current status, location and responsibility."
      />

      {error ? <div className="empty-state">Assets unavailable: {error}</div> : null}

      <div className="chip-row">
        <StatusBadge tone="info">Live registry</StatusBadge>
        <StatusBadge tone="warning">Active custody</StatusBadge>
        <StatusBadge tone="critical">Open issues</StatusBadge>
        <StatusBadge>Metadata Cine</StatusBadge>
      </div>

      <div className="list-layout">
        <SurfaceCard
          title="Asset registry"
          subtitle="Identity, current state and open issue count in one pass."
        >
          <DataTable
            columns={[
              {
                key: "asset",
                label: "Asset",
                render: (row) => (
                  <div className="identity-cell">
                    <Link className="identity-title" to={`/assets/${row.id}`}>
                      {row.name}
                    </Link>
                    <span className="identity-meta">
                      {row.code} · {row.category}
                    </span>
                  </div>
                ),
              },
              { key: "status", label: "Status", render: (row) => row.status },
              { key: "location", label: "Location", render: (row) => row.location },
              { key: "project", label: "Project", render: (row) => row.project },
              { key: "responsible", label: "Responsible", render: (row) => row.responsible },
              { key: "incidents", label: "Open issues", align: "right", render: (row) => row.incidentsOpen },
            ]}
            rows={assets}
          />
        </SurfaceCard>

        <SurfaceCard title="Quick preview" subtitle="Fast read of the selected asset before opening full detail.">
          {activeAsset ? (
            <>
              <div className="summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Current asset</span>
                  <span className="summary-value">{activeAsset.name}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Internal code</span>
                  <span className="summary-value">{activeAsset.code}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Location</span>
                  <span className="summary-value">{activeAsset.location}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Responsible</span>
                  <span className="summary-value">{activeAsset.responsible}</span>
                </div>
              </div>

              <div className="chip-row">
                <StatusBadge tone="info">Assign</StatusBadge>
                <StatusBadge tone="warning">Move</StatusBadge>
                <StatusBadge tone="critical">Report issue</StatusBadge>
              </div>
            </>
          ) : (
            <div className="empty-state">No assets loaded yet.</div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};
