import type {
  IncidentDetailSnapshot,
  IncidentListQuery,
  IncidentListRow,
  IncidentMutationResult,
  ReportIncidentCommand,
  ReportIncidentResult,
  ResolveIncidentCommand,
  UpdateIncidentCommand,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyIncidents: IncidentListRow[] = [];

const defaultIncidentListQuery: IncidentListQuery = {
  scopeProjectId: null,
  search: "",
  sortBy: "reportedAt",
  sortDirection: "desc",
};

const emptyIncidentDetail: IncidentDetailSnapshot = {
  incident: null,
  files: [],
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

export const useIncidentDetail = (incidentId: string | null) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiIncidents || !incidentId) {
        return emptyIncidentDetail;
      }

      return window.bukowskiIncidents.getDetail(incidentId);
    },
    emptyIncidentDetail,
    [incidentId],
  );

export const reportIncident = async (input: ReportIncidentCommand): Promise<ReportIncidentResult> => {
  if (!window.bukowskiIncidents) {
    throw new Error("Incidents bridge unavailable");
  }

  return window.bukowskiIncidents.report(input);
};

export const updateIncident = async (input: UpdateIncidentCommand): Promise<IncidentMutationResult> => {
  if (!window.bukowskiIncidents) {
    throw new Error("Incidents bridge unavailable");
  }

  return window.bukowskiIncidents.update(input);
};

export const resolveIncident = async (input: ResolveIncidentCommand): Promise<IncidentMutationResult> => {
  if (!window.bukowskiIncidents) {
    throw new Error("Incidents bridge unavailable");
  }

  return window.bukowskiIncidents.resolve(input);
};

export const uploadIncidentFiles = async (incidentId: string) => {
  if (!window.bukowskiIncidents) {
    throw new Error("Incidents bridge unavailable");
  }

  return window.bukowskiIncidents.uploadFiles(incidentId);
};

export const openIncidentFile = async (fileId: string) => {
  if (!window.bukowskiIncidents) {
    throw new Error("Incidents bridge unavailable");
  }

  return window.bukowskiIncidents.openFile(fileId);
};
