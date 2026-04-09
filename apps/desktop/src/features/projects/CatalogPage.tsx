import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";

const locations = [
  { code: "WH-A", name: "Warehouse A", type: "Storage" },
  { code: "SET-B", name: "Set / Cam B", type: "Field" },
  { code: "SRV-1", name: "Service Bench", type: "Maintenance" },
];

const departments = [
  { code: "CAM", name: "Camera" },
  { code: "GE", name: "Grip & Electric" },
  { code: "VID", name: "Video Assist" },
];

export const CatalogPage = () => (
  <div className="page-stack">
    <SectionHeader
      eyebrow="Catalog"
      title="Configurable operational catalog, not hardcoded Metadata-only labels"
      body="Departments, locations and categories should be configurable from day one so the product can later travel beyond one company."
    />

    <div className="split-layout">
      <SurfaceCard title="Locations" subtitle="Warehouse, field and maintenance contexts share one model with different types.">
        <DataTable
          columns={[
            { key: "code", label: "Code", render: (row) => row.code },
            { key: "name", label: "Name", render: (row) => row.name },
            { key: "type", label: "Type", render: (row) => row.type },
          ]}
          rows={locations}
        />
      </SurfaceCard>

      <SurfaceCard title="Departments" subtitle="Operational groupings stay configurable and reusable across projects and flows.">
        <DataTable
          columns={[
            { key: "code", label: "Code", render: (row) => row.code },
            { key: "name", label: "Name", render: (row) => row.name },
          ]}
          rows={departments}
        />
      </SurfaceCard>
    </div>
  </div>
);
