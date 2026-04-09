import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { packingSlips } from "@shared/lib/sample-data";

export const PackingPage = () => (
  <div className="page-stack">
    <SectionHeader
      eyebrow="Packing slips"
      title="Structured output and return control without spreadsheet fatigue"
      body="Packing slips are treated as operational documents with clear status, responsible party and return pressure."
    />

    <SurfaceCard title="Active slips" subtitle="Partial returns and overdue slips should be visible immediately, not buried inside paperwork flows.">
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
        rows={packingSlips}
      />
    </SurfaceCard>
  </div>
);
