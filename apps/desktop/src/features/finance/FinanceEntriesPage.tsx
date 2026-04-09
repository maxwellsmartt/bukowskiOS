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
        title="Ledger shell with clear structure and restrained ambition"
        body="This is intentionally not a full accounting module yet. It is the structural place where linked financial entries can live without inventing heavy workflows too early."
      />

      {error ? <div className="empty-state">Entries unavailable: {error}</div> : null}

      <SurfaceCard title="Entry register" subtitle="Status, linkage and project context should already read naturally inside the shell.">
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
          <strong>What this shell is ready for</strong>
          <span>Linked incident reserves, replacement exposure, collaborator fee hooks and future ledger workflows.</span>
        </div>
      </SurfaceCard>
    </div>
  );
};
