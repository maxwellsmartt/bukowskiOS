import type { DatabaseSync } from "node:sqlite";

import type { NotificationCreateCommand } from "@contracts";

import type { FoundationReadService } from "./foundationReadService";

// Proactive operational alerts. Periodically scans for situations that need
// attention (overdue returns, incidents without a cost estimate, schedule
// conflicts) and pushes an in-app notification to the workspace's coordinators
// (admins + supervisors). Idempotent: an alert that already has an unread
// notification for a recipient is not re-sent, so the sweep can run on every
// app open + on an interval without spamming.

type NotificationsDependency = {
  createNotification: (input: NotificationCreateCommand) => unknown;
};

type FoundationReadsDependency = Pick<
  FoundationReadService,
  "getPackingSlips" | "getProjectConflicts" | "getIncidents"
>;

type OperationalAlert = {
  alertKey: string;
  severity: "warning" | "critical";
  title: string;
  body: string;
  linkTo: string;
};

const addDays = (isoDate: string, offset: number) => {
  const next = new Date(`${isoDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
};

export const createOperationalAlertsService = (
  db: DatabaseSync,
  options: {
    foundationReads: FoundationReadsDependency;
    notifications: NotificationsDependency;
  },
) => {
  const { foundationReads, notifications } = options;

  const computeAlerts = (): OperationalAlert[] => {
    const alerts: OperationalAlert[] = [];

    // Overdue returns — one alert per slip so it can be acted on individually.
    const overdue = foundationReads
      .getPackingSlips({ sortBy: "dueDate", sortDirection: "asc" })
      .filter((row) => row.status.toLowerCase().includes("overdue"));
    for (const slip of overdue) {
      alerts.push({
        alertKey: `overdue_return:${slip.id}`,
        severity: "warning",
        title: "Retorno vencido",
        body: `El packing slip ${slip.number} (${slip.project}) está vencido en su retorno (vencía ${slip.dueDate}).`,
        linkTo: "/packing-slips",
      });
    }

    // Incidents still missing a cost estimate — one alert per incident.
    const incidentsMissingCost = foundationReads
      .getIncidents({ sortBy: "reportedAt", sortDirection: "desc" })
      .filter((row) => row.status === "Open" || row.status === "In review")
      .filter((row) => row.costEstimate === "Pending");
    for (const incident of incidentsMissingCost) {
      alerts.push({
        alertKey: `incident_no_cost:${incident.id}`,
        severity: incident.severity === "Critical" || incident.severity === "High" ? "critical" : "warning",
        title: "Incidente sin costo estimado",
        body: `El incidente "${incident.title}" (${incident.project}) sigue sin estimación de costo y está ${incident.status}.`,
        linkTo: "/incidents",
      });
    }

    // Schedule conflicts — a single rollup so a busy window doesn't flood
    // coordinators with one notice per overlapping pair.
    const rangeStart = new Date().toISOString().slice(0, 10);
    const conflicts = foundationReads.getProjectConflicts({ rangeStart, rangeEnd: addDays(rangeStart, 30) });
    if (conflicts.length) {
      alerts.push({
        alertKey: `schedule_conflicts:${rangeStart}`,
        severity: "warning",
        title: "Conflictos de agenda",
        body: `Hay ${conflicts.length} conflicto(s) de agenda (solapamiento de unidades/crew) en los próximos 30 días.`,
        linkTo: "/projects",
      });
    }

    return alerts;
  };

  const resolveCoordinators = (workspaceId: string): string[] => {
    const rows = db
      .prepare(
        `
          SELECT DISTINCT wm.user_id AS user_id
          FROM workspace_memberships wm
          JOIN roles r ON r.id = wm.role_id
          WHERE wm.workspace_id = ?
            AND wm.status = 'active'
            AND r.key IN ('admin', 'supervisor')
            AND wm.user_id <> 'user-ops'
        `,
      )
      .all(workspaceId) as Array<{ user_id: string }>;
    return rows.map((row) => row.user_id);
  };

  // Dedup on EXISTENCE within the cooldown window — read or unread. Keying on
  // unread re-fired the same alert every sweep as soon as the user marked it
  // read; existence-based dedup means an alert is created once per window and
  // only re-surfaces after the cooldown if the situation is still unresolved.
  const hasRecentAlert = (workspaceId: string, userId: string, alertKey: string, sinceIso: string): boolean => {
    const row = db
      .prepare(
        `
          SELECT 1
          FROM notifications
          WHERE workspace_id = ?
            AND user_id = ?
            AND kind = 'operational_alert'
            AND created_at >= ?
            AND source_ref LIKE ?
          LIMIT 1
        `,
      )
      .get(workspaceId, userId, sinceIso, `%"alertKey":"${alertKey}"%`);
    return Boolean(row);
  };

  const runSweep = (workspaceId: string): { alerts: number; notified: number } => {
    const alerts = computeAlerts();
    if (!alerts.length) {
      return { alerts: 0, notified: 0 };
    }

    const coordinators = resolveCoordinators(workspaceId);
    if (!coordinators.length) {
      return { alerts: alerts.length, notified: 0 };
    }

    const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let notified = 0;
    for (const alert of alerts) {
      for (const userId of coordinators) {
        if (hasRecentAlert(workspaceId, userId, alert.alertKey, sinceIso)) {
          continue;
        }
        notifications.createNotification({
          userId,
          workspaceId,
          kind: "operational_alert",
          title: alert.title,
          body: alert.body,
          sourceType: "agent",
          sourceRef: { type: "operational_alert", alertKey: alert.alertKey, severity: alert.severity },
          linkTo: alert.linkTo,
        });
        notified += 1;
      }
    }

    return { alerts: alerts.length, notified };
  };

  return { computeAlerts, runSweep };
};

export type OperationalAlertsService = ReturnType<typeof createOperationalAlertsService>;
