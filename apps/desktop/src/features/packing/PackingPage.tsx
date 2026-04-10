import { useEffect, useState } from "react";

import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { PackingSlipDetailPanel } from "./PackingSlipDetailPanel";
import { returnPackingSlipItems, usePackingDetail, usePackingList } from "./usePackingData";

export const PackingPage = () => {
  const sectionScopeLabel = useSectionScopeLabel();
  const { data, error, reload } = usePackingList();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [activePackingSlipId, setActivePackingSlipId] = useState<string | null>(() =>
    readStringPreference(uiPreferenceKeys.activePackingSlipId),
  );
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnFeedback, setReturnFeedback] = useState<string | null>(null);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = usePackingDetail(activePackingSlipId);

  useEffect(() => {
    if (!data.length) {
      setActivePackingSlipId(null);
      return;
    }

    if (activePackingSlipId && data.some((row) => row.id === activePackingSlipId)) {
      return;
    }

    setActivePackingSlipId(data[0]?.id ?? null);
  }, [activePackingSlipId, data]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.activePackingSlipId, activePackingSlipId);
  }, [activePackingSlipId]);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Packing slips"
        title="Outgoing and return control"
        body="Operational documents for dispatch, pending returns and custody handoff across active projects."
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Packing slips unavailable: {error}</div> : null}
      {returnFeedback ? <div className="action-feedback action-feedback-success">{returnFeedback}</div> : null}

      <div className="split-layout">
        <SurfaceCard title="Slip registry" subtitle="Issued, partial-return, overdue and closed slips visible in one operational queue.">
          <DataTable
            activeRowId={activePackingSlipId}
            getRowId={(row) => row.id}
            maxHeight="min(68vh, 720px)"
            persistKey="packing-slips"
            columns={[
              { key: "number", label: "Slip", width: 92, minWidth: 82, render: (row) => row.number },
              { key: "project", label: "Project", width: 180, minWidth: 144, render: (row) => row.project },
              { key: "department", label: "Department", width: 140, minWidth: 116, render: (row) => row.department },
              { key: "responsible", label: "Responsible", width: 150, minWidth: 126, render: (row) => row.responsible },
              { key: "issuedDate", label: "Issued", width: 90, minWidth: 80, render: (row) => row.issuedDate },
              { key: "dueDate", label: "Due", width: 90, minWidth: 80, render: (row) => row.dueDate },
              { key: "itemCount", label: "Items", align: "right", width: 74, minWidth: 62, render: (row) => row.itemCount },
              {
                key: "returnedCount",
                label: "Returned",
                align: "right",
                width: 84,
                minWidth: 72,
                render: (row) => row.returnedCount,
              },
              {
                key: "status",
                label: "Status",
                width: 116,
                minWidth: 96,
                render: (row) => (
                  <StatusBadge
                    tone={
                      row.status === "Overdue"
                        ? "critical"
                        : row.status === "Closed"
                          ? "success"
                          : row.status === "Issued"
                            ? "info"
                            : "warning"
                    }
                  >
                    {row.status}
                  </StatusBadge>
                ),
              },
            ]}
            rows={data}
            selectable
            selectedRowIds={selectedRowIds}
            onRowClick={(row) => {
              setActivePackingSlipId(row.id);
              setReturnError(null);
            }}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        <PackingSlipDetailPanel
          data={detail}
          error={returnError ?? detailError}
          isLoading={detailLoading}
          isSubmittingReturn={isSubmittingReturn}
          onReturnItems={async (assetIds, conditionIn, notes) => {
            if (!activePackingSlipId) {
              return;
            }

            try {
              setIsSubmittingReturn(true);
              const result = await returnPackingSlipItems({
                commandId: crypto.randomUUID(),
                workspaceId: "workspace-metadata",
                packingSlipId: activePackingSlipId,
                assetIds,
                conditionIn,
                notes,
                actorType: "user",
                sourceChannel: "desktop",
              });

              await Promise.all([reload(), reloadDetail()]);
              setReturnError(null);
              setReturnFeedback(result.summary);
            } catch (nextError) {
              setReturnError(nextError instanceof Error ? nextError.message : "Unable to register packing return.");
            } finally {
              setIsSubmittingReturn(false);
            }
          }}
        />
      </div>
    </div>
  );
};
