import { Link } from "react-router-dom";

import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { assets } from "@shared/lib/sample-data";

const activeAsset = assets[0];

export const AssetsPage = () => (
  <div className="page-stack">
    <SectionHeader
      eyebrow="AssetsOps"
      title="Inventory list with medium density and immediate operational context"
      body="The list stays readable first, but dense enough for real operators. Filters remain visible, status remains obvious and the detail preview stays one glance away."
    />

    <div className="chip-row">
      <StatusBadge tone="info">Camera</StatusBadge>
      <StatusBadge tone="warning">Assigned assets</StatusBadge>
      <StatusBadge tone="critical">Open incidents</StatusBadge>
      <StatusBadge>Project scope: Aurora Campaign</StatusBadge>
    </div>

    <div className="list-layout">
      <SurfaceCard
        title="Asset registry"
        subtitle="Identity first. Current state second. History available without cluttering the list."
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

      <SurfaceCard title="Live preview" subtitle="This right-hand pane becomes the fast read layer before opening full asset detail.">
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
      </SurfaceCard>
    </div>
  </div>
);
