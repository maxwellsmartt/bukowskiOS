import { Link } from "react-router-dom";

import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useAssetsList } from "./useAssetsData";

export const AssetsPage = () => <AssetsContent />;

const AssetsContent = () => {
  const { data: assets, error, isLoading } = useAssetsList();
  const activeAsset = assets[0];

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Assets"
        title="Inventory"
        body="Legacy inventory mounted into the live registry with status, quantity and storage context."
      />

      {error ? <div className="empty-state">Assets unavailable: {error}</div> : null}
      {!error && isLoading ? <div className="empty-state">Loading asset registry...</div> : null}

      <div className="chip-row">
        <StatusBadge tone="info">Live registry</StatusBadge>
        <StatusBadge tone="warning">Legacy import</StatusBadge>
        <StatusBadge tone="critical">Open issues</StatusBadge>
        <StatusBadge>Metadata Cine</StatusBadge>
      </div>

      <div className="list-layout">
        <SurfaceCard
          title="Asset registry"
          subtitle="Identity, quantity, current state and storage context in one pass."
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
              { key: "quantity", label: "Qty", align: "right", render: (row) => row.quantity },
              { key: "tracking", label: "Tracking", render: (row) => row.tracking },
              { key: "status", label: "Status", render: (row) => row.status },
              { key: "location", label: "Location", render: (row) => row.location },
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
                  <span className="summary-label">Registry code</span>
                  <span className="summary-value">{activeAsset.code}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Quantity</span>
                  <span className="summary-value">
                    {activeAsset.quantity} · {activeAsset.tracking}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Location</span>
                  <span className="summary-value">{activeAsset.location}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Project / responsible</span>
                  <span className="summary-value">
                    {activeAsset.project} · {activeAsset.responsible}
                  </span>
                </div>
              </div>

              <div className="chip-row">
                <StatusBadge tone="info">Ready to normalize</StatusBadge>
                <StatusBadge tone="warning">Assignment flow next</StatusBadge>
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
