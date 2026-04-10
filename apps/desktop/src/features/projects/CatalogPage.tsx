import { useState } from "react";

import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

import { useCatalogData } from "./useProjectsData";

export const CatalogPage = () => {
  const { data, error } = useCatalogData();
  const sectionScopeLabel = useSectionScopeLabel();
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Catalog"
        title="Operational catalog"
        body="Core locations and departments used across operational flows."
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Catalog unavailable: {error}</div> : null}

      <div className="split-layout">
        <SurfaceCard title="Locations" subtitle="Warehouse, field and maintenance locations available in the workspace.">
          <DataTable
            getRowId={(row) => row.code}
            maxHeight="min(56vh, 620px)"
            persistKey="catalog-locations"
            columns={[
              { key: "code", label: "Code", render: (row) => row.code },
              { key: "name", label: "Name", render: (row) => row.name },
              { key: "type", label: "Type", render: (row) => row.type },
            ]}
            rows={data.locations}
            selectable
            selectedRowIds={selectedLocationIds}
            onSelectedRowIdsChange={setSelectedLocationIds}
          />
        </SurfaceCard>

        <SurfaceCard title="Departments" subtitle="Operational groups reused across projects, assignments and incidents.">
          <DataTable
            getRowId={(row) => row.code}
            maxHeight="min(56vh, 620px)"
            persistKey="catalog-departments"
            columns={[
              { key: "code", label: "Code", render: (row) => row.code },
              { key: "name", label: "Name", render: (row) => row.name },
            ]}
            rows={data.departments}
            selectable
            selectedRowIds={selectedDepartmentIds}
            onSelectedRowIdsChange={setSelectedDepartmentIds}
          />
        </SurfaceCard>
      </div>
    </div>
  );
};
