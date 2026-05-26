import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DataTable } from "@shared/components/DataTable";
import { HelpHint } from "@shared/components/HelpHint";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useFinanceCostLinks } from "./useFinanceData";

export const FinanceCostLinksPage = () => {
  const { t } = useTranslation();
  const { data, error } = useFinanceCostLinks();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  return (
    <div className="page-stack">
      <SectionHeader title={t("finance.costLinks.title")} />

      {error ? <div className="empty-state">{t("finance.costLinks.unavailable", { message: error })}</div> : null}

      <SurfaceCard title={t("finance.costLinks.cardTitle")}>
        <DataTable
          getRowId={(row) => `${row.incident}-${row.asset}`}
          persistKey="finance-cost-links"
          columns={[
            {
              key: "incident",
              label: t("finance.costLinks.columns.incident"),
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.incident}</span>
                  <span className="identity-meta">{row.asset}</span>
                </div>
              ),
            },
            { key: "project", label: t("finance.costLinks.columns.project"), render: (row) => row.project },
            { key: "responsible", label: t("finance.costLinks.columns.responsible"), render: (row) => row.responsible },
            {
              key: "severity",
              label: t("finance.costLinks.columns.severity"),
              render: (row) => (
                <StatusBadge tone={row.severity === "High" ? "critical" : row.severity === "Medium" ? "warning" : "neutral"}>
                  {row.severity}
                </StatusBadge>
              ),
            },
            { key: "estimate", label: t("finance.costLinks.columns.estimate"), render: (row) => row.costEstimate },
            { key: "replacement", label: t("finance.costLinks.columns.replacement"), render: (row) => row.replacementValue },
            { key: "status", label: t("finance.costLinks.columns.financeStatus"), render: (row) => row.financialStatus },
          ]}
          rows={data}
          selectable
          selectedRowIds={selectedRowIds}
          onSelectedRowIdsChange={setSelectedRowIds}
        />
      </SurfaceCard>
    </div>
  );
};
