import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useFinanceEntries } from "./useFinanceData";

export const FinanceEntriesPage = () => {
  const { data, error } = useFinanceEntries();

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Finance / Entries"
        title="Entries"
        body="Linked reserves and exposure entries created from operational events."
      />

      {error ? <div className="empty-state">Entries unavailable: {error}</div> : null}

      <SurfaceCard title="Entry register" subtitle="Current financial entries linked to projects, assets and incidents.">
        <DataTable
          columns={[
            { key: "date", label: "Date", render: (row) => row.date },
            { key: "type", label: "Type", render: (row) => row.type },
            { key: "category", label: "Category", render: (row) => row.category },
            { key: "reference", label: "Reference", render: (row) => row.reference },
            { key: "project", label: "Project", render: (row) => row.project },
            { key: "amount", label: "Amount", align: "right", render: (row) => row.amount },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <StatusBadge tone={row.status === "Draft" ? "warning" : "info"}>{row.status}</StatusBadge>
              ),
            },
          ]}
          rows={data}
        />

        <div className="empty-state">
          <strong>Shell readiness</strong>
          <span>Incident reserves, replacement exposure, collaborator fee hooks and future ledger workflows.</span>
        </div>
      </SurfaceCard>
    </div>
  );
};
