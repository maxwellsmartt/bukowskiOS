import type { IncidentListRow, ReportIncidentCommand, ReportIncidentResult } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyIncidents: IncidentListRow[] = [];

export const useIncidentsData = (projectId: string | null = null) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiIncidents) {
        return emptyIncidents;
      }

      const rows = await window.bukowskiIncidents.getList();
      return projectId ? rows.filter((row) => row.projectId === projectId) : rows;
    },
    emptyIncidents,
    [projectId],
  );

export const reportIncident = async (input: ReportIncidentCommand): Promise<ReportIncidentResult> => {
  if (!window.bukowskiIncidents) {
    throw new Error("Incidents bridge unavailable");
  }

  return window.bukowskiIncidents.report(input);
};
