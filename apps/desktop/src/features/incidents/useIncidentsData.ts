import type { IncidentListRow } from "@contracts";
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
