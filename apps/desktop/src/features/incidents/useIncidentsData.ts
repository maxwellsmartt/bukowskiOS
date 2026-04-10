import type { IncidentListQuery, IncidentListRow, ReportIncidentCommand, ReportIncidentResult } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyIncidents: IncidentListRow[] = [];

const defaultIncidentListQuery: IncidentListQuery = {
  scopeProjectId: null,
  search: "",
  sortBy: "reportedAt",
  sortDirection: "desc",
};

export const useIncidentsData = (query: IncidentListQuery = defaultIncidentListQuery) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiIncidents) {
        return emptyIncidents;
      }

      return window.bukowskiIncidents.getList(query);
    },
    emptyIncidents,
    [query.scopeProjectId, query.search, query.sortBy, query.sortDirection],
  );

export const reportIncident = async (input: ReportIncidentCommand): Promise<ReportIncidentResult> => {
  if (!window.bukowskiIncidents) {
    throw new Error("Incidents bridge unavailable");
  }

  return window.bukowskiIncidents.report(input);
};
