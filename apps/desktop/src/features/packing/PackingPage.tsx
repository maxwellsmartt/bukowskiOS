import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { usePackingData } from "./usePackingData";

export const PackingPage = () => {
  const { data, error } = usePackingData();

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Packing slips"
        title="Outgoing and return control"
        body="Packing slips by project, department and responsible user."
      />

      {error ? <div className="empty-state">Packing slips unavailable: {error}</div> : null}

      <SurfaceCard title="Active slips" subtitle="Issued, partial-return and overdue slips visible at a glance.">
        <DataTable
          columns={[
            { key: "number", label: "Slip", render: (row) => row.number },
            { key: "project", label: "Project", render: (row) => row.project },
            { key: "department", label: "Department", render: (row) => row.department },
            { key: "responsible", label: "Responsible", render: (row) => row.responsible },
            { key: "dueDate", label: "Due", render: (row) => row.dueDate },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <StatusBadge tone={row.status === "Overdue" ? "critical" : row.status === "Issued" ? "info" : "warning"}>
                  {row.status}
                </StatusBadge>
              ),
            },
          ]}
          rows={data}
        />
      </SurfaceCard>
    </div>
  );
};
