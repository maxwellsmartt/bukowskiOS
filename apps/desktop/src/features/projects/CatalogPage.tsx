import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useCatalogData } from "./useProjectsData";

export const CatalogPage = () => {
  const { data, error } = useCatalogData();

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Catalog"
        title="Operational catalog"
        body="Core locations and departments used across operational flows."
      />

      {error ? <div className="empty-state">Catalog unavailable: {error}</div> : null}

      <div className="split-layout">
        <SurfaceCard title="Locations" subtitle="Warehouse, field and maintenance locations available in the workspace.">
          <DataTable
            columns={[
              { key: "code", label: "Code", render: (row) => row.code },
              { key: "name", label: "Name", render: (row) => row.name },
              { key: "type", label: "Type", render: (row) => row.type },
            ]}
            rows={data.locations}
          />
        </SurfaceCard>

        <SurfaceCard title="Departments" subtitle="Operational groups reused across projects, assignments and incidents.">
          <DataTable
            columns={[
              { key: "code", label: "Code", render: (row) => row.code },
              { key: "name", label: "Name", render: (row) => row.name },
            ]}
            rows={data.departments}
          />
        </SurfaceCard>
      </div>
    </div>
  );
};
