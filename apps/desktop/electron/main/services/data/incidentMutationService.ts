import type { DatabaseSync } from "node:sqlite";

import type { ReportIncidentCommand, ReportIncidentResult } from "@contracts";

const defaultActorUserId = "user-ops";

type AssetIncidentContextRow = {
  asset_id: string;
  asset_name: string;
  current_project_id: string | null;
  project_unit_id: string | null;
  current_department_id: string | null;
  current_responsible_user_id: string | null;
  active_assignment_id: string | null;
  current_location_id: string | null;
};

type ProjectUnitRow = {
  id: string;
  project_id: string;
  name: string;
};

const ensureValue = (value: string, label: string) => {
  const nextValue = value.trim();

  if (!nextValue) {
    throw new Error(`${label} is required.`);
  }

  return nextValue;
};

const uniqueValues = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];

const createPlaceholders = (values: string[]) => values.map(() => "?").join(", ");

const loadEntityMap = (db: DatabaseSync, tableName: "projects" | "departments" | "assets", values: string[]) => {
  if (!values.length) {
    return new Map<string, string>();
  }

  const nameField = tableName === "assets" ? "name" : "name";
  const rows = db
    .prepare(
      `
        SELECT id, ${nameField} AS label
        FROM ${tableName}
        WHERE id IN (${createPlaceholders(values)})
      `,
    )
    .all(...values) as Array<{ id: string; label: string }>;

  return new Map(rows.map((row) => [row.id, row.label]));
};

const loadUserMap = (db: DatabaseSync, values: string[]) => {
  if (!values.length) {
    return new Map<string, string>();
  }

  const rows = db
    .prepare(
      `
        SELECT id, full_name AS label
        FROM users
        WHERE id IN (${createPlaceholders(values)})
      `,
    )
    .all(...values) as Array<{ id: string; label: string }>;

  return new Map(rows.map((row) => [row.id, row.label]));
};

const loadProjectUnitMap = (db: DatabaseSync, values: string[]) => {
  if (!values.length) {
    return new Map<string, ProjectUnitRow>();
  }

  const rows = db
    .prepare(
      `
        SELECT id, project_id, name
        FROM project_units
        WHERE id IN (${createPlaceholders(values)})
      `,
    )
    .all(...values) as ProjectUnitRow[];

  return new Map(rows.map((row) => [row.id, row]));
};

const ensureEntityExists = (value: string | undefined, label: string, map: Map<string, string>) => {
  if (!value) {
    return;
  }

  if (!map.has(value)) {
    throw new Error(`${label} not found.`);
  }
};

const buildIncidentSummary = (title: string, assetName?: string, projectName?: string) => {
  if (assetName && projectName) {
    return `${title} logged for ${assetName} on ${projectName}.`;
  }

  if (assetName) {
    return `${title} logged for ${assetName}.`;
  }

  if (projectName) {
    return `${title} logged for ${projectName}.`;
  }

  return `${title} logged successfully.`;
};

export const createIncidentMutationService = (db: DatabaseSync) => ({
  reportIncident(input: ReportIncidentCommand): ReportIncidentResult {
    const title = ensureValue(input.title, "Incident title");
    const description = ensureValue(input.description, "Incident description");
    const incidentType = ensureValue(input.incidentType, "Incident type");
    const severity = ensureValue(input.severity, "Severity");

    if (!input.assetId && !input.projectId) {
      throw new Error("Incident reporting needs at least an asset or project context.");
    }

    const existingReceipt = db
      .prepare(
        `
          SELECT outcome_status
          FROM command_receipts
          WHERE command_id = ?
          LIMIT 1
        `,
      )
      .get(input.commandId) as { outcome_status: string } | undefined;

    if (existingReceipt?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        incidentId: `incident-${input.commandId}`,
        repeated: true,
        summary: "This incident command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error("This command id already failed once. Generate a new action and retry.");
    }

    const assetContext = input.assetId
      ? (db
          .prepare(
            `
              SELECT
                asset_current_state.asset_id,
                assets.name AS asset_name,
                asset_current_state.current_project_id,
                asset_current_state.project_unit_id,
                asset_current_state.current_department_id,
                asset_current_state.current_responsible_user_id,
                asset_current_state.active_assignment_id,
                asset_current_state.current_location_id
              FROM asset_current_state
              JOIN assets ON assets.id = asset_current_state.asset_id
              WHERE asset_current_state.workspace_id = ?
                AND asset_current_state.asset_id = ?
              LIMIT 1
            `,
          )
          .get(input.workspaceId, input.assetId) as AssetIncidentContextRow | undefined)
      : undefined;

    if (input.assetId && !assetContext) {
      throw new Error("Selected asset is no longer available in the local registry.");
    }

    const projectUnitMap = loadProjectUnitMap(db, uniqueValues([input.projectUnitId]));
    const explicitUnit = input.projectUnitId ? projectUnitMap.get(input.projectUnitId) : undefined;
    let nextProjectId = input.projectId ?? assetContext?.current_project_id ?? undefined;
    let nextProjectUnitId = input.projectUnitId ?? assetContext?.project_unit_id ?? undefined;
    const nextDepartmentId = input.departmentId ?? assetContext?.current_department_id ?? undefined;
    const nextResponsibleUserId = input.responsibleUserId ?? assetContext?.current_responsible_user_id ?? undefined;
    const nextAssignmentId = input.assignmentId ?? assetContext?.active_assignment_id ?? undefined;
    const nextLocationId = assetContext?.current_location_id ?? undefined;

    if (input.projectUnitId && !explicitUnit) {
      throw new Error("Project unit not found.");
    }

    if (explicitUnit) {
      if (nextProjectId && nextProjectId !== explicitUnit.project_id) {
        throw new Error("Selected unit does not belong to the chosen project.");
      }

      nextProjectId = explicitUnit.project_id;
      nextProjectUnitId = explicitUnit.id;
    }

    if (!nextProjectId) {
      nextProjectUnitId = undefined;
    }

    const projectMap = loadEntityMap(db, "projects", uniqueValues([nextProjectId]));
    const departmentMap = loadEntityMap(db, "departments", uniqueValues([nextDepartmentId]));
    const assetMap = loadEntityMap(db, "assets", uniqueValues([input.assetId]));
    const userMap = loadUserMap(db, uniqueValues([nextResponsibleUserId, defaultActorUserId]));

    ensureEntityExists(nextProjectId, "Project", projectMap);
    ensureEntityExists(nextDepartmentId, "Department", departmentMap);
    ensureEntityExists(input.assetId, "Asset", assetMap);
    ensureEntityExists(nextResponsibleUserId, "Responsible user", userMap);
    ensureEntityExists(defaultActorUserId, "Actor user", userMap);

    const workspaceCurrency = (db
      .prepare("SELECT base_currency FROM workspaces WHERE id = ? LIMIT 1")
      .get(input.workspaceId) as { base_currency: string } | undefined)?.base_currency;

    const costEstimate = typeof input.costEstimate === "number" && Number.isFinite(input.costEstimate) ? input.costEstimate : null;
    const currency = input.currency?.trim() || workspaceCurrency || "USD";
    const financialStatus = input.financialStatus?.trim() || (costEstimate !== null ? "Estimate linked" : "Estimate missing");
    const now = new Date().toISOString();
    const incidentId = `incident-${input.commandId}`;
    const eventId = input.assetId ? `event-${input.commandId}` : null;
    const assetName = input.assetId ? assetMap.get(input.assetId) : undefined;
    const projectName = nextProjectId ? projectMap.get(nextProjectId) : undefined;

    const insertReceipt = db.prepare(
      `
        INSERT OR REPLACE INTO command_receipts (
          command_id,
          workspace_id,
          actor_user_id,
          actor_type,
          source_channel,
          executed_at,
          outcome_status,
          error_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          INSERT INTO incidents (
            id,
            workspace_id,
            asset_id,
            project_id,
            project_unit_id,
            department_id,
            assignment_id,
            reported_by_user_id,
            incident_type,
            severity,
            status,
            title,
            description,
            reported_at,
            resolved_at,
            responsible_user_id,
            cost_estimate,
            currency,
            financial_status,
            notes,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        incidentId,
        input.workspaceId,
        input.assetId ?? null,
        nextProjectId ?? null,
        nextProjectUnitId ?? null,
        nextDepartmentId ?? null,
        nextAssignmentId ?? null,
        defaultActorUserId,
        incidentType,
        severity,
        title,
        description,
        now,
        nextResponsibleUserId ?? null,
        costEstimate,
        currency,
        financialStatus,
        input.notes?.trim() || null,
        now,
        now,
      );

      if (input.assetId && eventId) {
        const metadataJson = JSON.stringify({
          incidentId,
          incidentType,
          severity,
          costEstimate,
          currency,
          financialStatus,
          projectUnitId: nextProjectUnitId ?? null,
        });

        db.prepare(
          `
            INSERT INTO asset_events (
              id,
              workspace_id,
              asset_id,
              assignment_id,
              project_id,
              department_id,
              performed_by_user_id,
              event_type,
              location_id,
              from_location_id,
              to_location_id,
              event_timestamp,
              command_id,
              actor_type,
              source_channel,
              notes,
              metadata_json,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'incident_reported', ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          eventId,
          input.workspaceId,
          input.assetId,
          nextAssignmentId ?? null,
          nextProjectId ?? null,
          nextDepartmentId ?? null,
          defaultActorUserId,
          nextLocationId ?? null,
          now,
          input.commandId,
          input.actorType,
          input.sourceChannel,
          input.notes?.trim() || title,
          metadataJson,
          now,
        );

        db.prepare(
          `
            INSERT INTO sync_outbox (
              id,
              workspace_id,
              entity_type,
              entity_id,
              event_id,
              operation_type,
              payload_json,
              status,
              attempt_count,
              last_error,
              next_retry_at,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'asset_event', ?, ?, 'upsert', ?, 'pending', 0, NULL, NULL, ?, ?)
          `,
        ).run(
          `outbox-${eventId}`,
          input.workspaceId,
          input.assetId,
          eventId,
          metadataJson,
          now,
          now,
        );
      }

      db.prepare(
        `
          INSERT INTO sync_outbox (
            id,
            workspace_id,
            entity_type,
            entity_id,
            event_id,
            operation_type,
            payload_json,
            status,
            attempt_count,
            last_error,
            next_retry_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, 'incident', ?, NULL, 'upsert', ?, 'pending', 0, NULL, NULL, ?, ?)
        `,
      ).run(
        `outbox-${incidentId}`,
        input.workspaceId,
        incidentId,
        JSON.stringify({
          incidentId,
          assetId: input.assetId ?? null,
          projectId: nextProjectId ?? null,
          projectUnitId: nextProjectUnitId ?? null,
          responsibleUserId: nextResponsibleUserId ?? null,
          severity,
          financialStatus,
        }),
        now,
        now,
      );

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "success",
        null,
      );

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        incidentId,
        repeated: false,
        summary: buildIncidentSummary(title, assetName, projectName),
      };
    } catch (error) {
      db.exec("ROLLBACK");

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "failed",
        error instanceof Error ? error.message : "Unknown incident mutation error",
      );

      throw error;
    }
  },
});
