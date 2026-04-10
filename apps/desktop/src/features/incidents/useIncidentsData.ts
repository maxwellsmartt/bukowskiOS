import type { IncidentListRow, ReportIncidentCommand, ReportIncidentResult } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyIncidents: IncidentListRow[] = [];

export const useIncidentsData = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiIncidents) {
        return emptyIncidents;
      }

      return window.bukowskiIncidents.getList();
    },
    emptyIncidents,
    [],
  );

export const reportIncident = async (input: ReportIncidentCommand): Promise<ReportIncidentResult> => {
  if (!window.bukowskiIncidents) {
    throw new Error("Incidents bridge unavailable");
  }

  return window.bukowskiIncidents.report(input);
};
