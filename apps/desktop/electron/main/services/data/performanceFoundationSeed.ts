import type { DatabaseSync } from "node:sqlite";

import { LOCAL_FALLBACK_WORKSPACE_ID } from "@contracts";

const workspaceId = LOCAL_FALLBACK_WORKSPACE_ID;
const now = "2026-04-12T18:00:00.000Z";

const runBulkInsert = (db: DatabaseSync, sql: string, rows: Array<Array<string | number | null>>) => {
  const statement = db.prepare(sql);
  rows.forEach((row) => {
    statement.run(...row);
  });
};

const pad = (value: number, length = 3) => `${value}`.padStart(length, "0");

const buildProjectWindow = (index: number) => {
  const startDay = ((index * 3) % 120) + 1;
  const endDay = startDay + 18 + (index % 6);
  return {
    startDate: `2026-05-${pad(((startDay - 1) % 28) + 1, 2)}`,
    endDate: `2026-06-${pad(((endDay - 1) % 28) + 1, 2)}`,
  };
};

export const seedPerformanceFoundationData = (db: DatabaseSync) => {
  const marker = db
    .prepare(
      `
        SELECT 1 AS present
        FROM projects
        WHERE workspace_id = ?
          AND id = 'project-perf-001'
        LIMIT 1
      `,
    )
    .get(workspaceId) as { present: number } | undefined;

  if (marker) {
    return;
  }

  const extraProjects: Array<Array<string | number | null>> = [];
  const extraUnits: Array<Array<string | number | null>> = [];
  const extraAssets: Array<Array<string | number | null>> = [];
  const extraAssignments: Array<Array<string | number | null>> = [];
  const extraEvents: Array<Array<string | number | null>> = [];
  const extraAssetState: Array<Array<string | number | null>> = [];
  const extraIncidents: Array<Array<string | number | null>> = [];
  const extraPackingSlips: Array<Array<string | number | null>> = [];
  const extraFinanceEntries: Array<Array<string | number | null>> = [];
  const extraThreads: Array<Array<string | number | null>> = [];
  const extraThreadState: Array<Array<string | number | null>> = [];
  const extraMessages: Array<Array<string | number | null>> = [];
  const extraAgentRuns: Array<Array<string | number | null>> = [];
  const extraAgentActivity: Array<Array<string | number | null>> = [];

  for (let index = 1; index <= 30; index += 1) {
    const projectId = `project-perf-${pad(index)}`;
    const { startDate, endDate } = buildProjectWindow(index);
    const colorKeys = ["ice", "amber", "teal", "steel", "moss", "rose", "violet", "copper"];
    const projectStatus = index % 5 === 0 ? "Prep" : index % 6 === 0 ? "Wrap" : "Active";

    extraProjects.push([
      projectId,
      workspaceId,
      `PERF-${pad(index)}`,
      `Performance Project ${pad(index)}`,
      `Client ${((index - 1) % 10) + 1}`,
      projectStatus,
      startDate,
      endDate,
      `Synthetic project used for runtime profiling batch ${pad(index)}.`,
      now,
      now,
      colorKeys[index % colorKeys.length],
    ]);

    for (let unitIndex = 1; unitIndex <= 2; unitIndex += 1) {
      const unitId = `${projectId}-unit-${unitIndex}`;
      extraUnits.push([
        unitId,
        workspaceId,
        projectId,
        `U${unitIndex}`,
        `Unit ${unitIndex}`,
        unitIndex,
        unitIndex === 3 && index % 4 === 0 ? "Completed" : "Active",
        "derived",
        colorKeys[(index + unitIndex) % colorKeys.length],
        startDate,
        endDate,
        `Synthetic unit ${unitIndex} for ${projectId}.`,
        now,
        now,
      ]);
    }

    for (let assetIndex = 1; assetIndex <= 3; assetIndex += 1) {
      const assetId = `${projectId}-asset-${assetIndex}`;
      const eventId = `${assetId}-event`;
      const assignmentId = `${assetId}-assign`;
      const locationId = assetIndex % 2 === 0 ? "loc-warehouse-a" : "loc-video-village";
      const categoryId = assetIndex % 2 === 0 ? "cat-monitors" : "cat-wireless-video";

      extraAssets.push([
        assetId,
        workspaceId,
        categoryId,
        `Performance Asset ${pad(index)}-${assetIndex}`,
        assetIndex % 2 === 0 ? "SmallHD" : "Teradek",
        assetIndex % 2 === 0 ? "Cine 7" : "Bolt 6 XT",
        `PERF-SN-${pad(index)}-${assetIndex}`,
        `PERF-${pad(index)}-${assetIndex}`,
        "Synthetic asset for runtime profiling.",
        "2025-01-15",
        950 + assetIndex * 125,
        "USD",
        1450 + assetIndex * 175,
        1200 + assetIndex * 140,
        "owned",
        locationId,
        `qr-perf-${pad(index)}-${assetIndex}`,
        "",
        1,
        now,
        now,
      ]);

      extraAssignments.push([
        assignmentId,
        workspaceId,
        assetId,
        projectId,
        assetIndex % 2 === 0 ? "dept-camera" : "dept-video",
        assetIndex % 2 === 0 ? "user-paola" : "user-luis",
        "user-paola",
        "loc-warehouse-a",
        locationId,
        assetIndex % 3 === 0 ? "checked_out" : "assigned",
        now,
        endDate,
        null,
        "Synthetic assignment for runtime profiling.",
        now,
        now,
      ]);

      extraEvents.push([
        eventId,
        workspaceId,
        assetId,
        assignmentId,
        projectId,
        assetIndex % 2 === 0 ? "dept-camera" : "dept-video",
        "user-paola",
        assetIndex % 3 === 0 ? "asset_checked_out" : "asset_assigned",
        locationId,
        "loc-warehouse-a",
        locationId,
        now,
        `cmd-${eventId}`,
        "user",
        "desktop",
        "Synthetic asset event for runtime profiling.",
        JSON.stringify({ synthetic: true }),
        now,
      ]);

      extraAssetState.push([
        assetId,
        workspaceId,
        locationId,
        projectId,
        assetIndex % 2 === 0 ? "dept-camera" : "dept-video",
        assetIndex % 2 === 0 ? "user-paola" : "user-luis",
        assignmentId,
        assetIndex % 4 === 0 ? "review" : "good",
        assetIndex % 4 === 0 ? "maintenance" : "ready",
        assetIndex % 3 === 0 ? "checked_out" : "assigned",
        eventId,
        1,
        now,
      ]);
    }

    if (index <= 30) {
      const incidentId = `incident-perf-${pad(index)}`;
      extraIncidents.push([
        incidentId,
        workspaceId,
        `${projectId}-asset-1`,
        projectId,
        "dept-camera",
        null,
        "user-paola",
        index % 2 === 0 ? "damage" : "maintenance",
        index % 5 === 0 ? "High" : "Medium",
        index % 7 === 0 ? "In review" : "Open",
        `Synthetic incident ${pad(index)}`,
        "Generated to profile incident queues under heavier local datasets.",
        now,
        null,
        "user-ops",
        150 + index,
        "USD",
        "Estimate linked",
        "",
        now,
        now,
      ]);
    }

    if (index <= 24) {
      const packingSlipId = `packing-perf-${pad(index)}`;
      extraPackingSlips.push([
        packingSlipId,
        workspaceId,
        projectId,
        "dept-camera",
        "user-paola",
        null,
        "user-paola",
        index % 3 === 0 ? "Partial return" : "Issued",
        startDate,
        endDate,
        "Synthetic packing slip for profiling queues.",
        now,
        now,
      ]);
    }

    if (index <= 30) {
      const entryId = `entry-perf-${pad(index)}`;
      extraFinanceEntries.push([
        entryId,
        workspaceId,
        index % 2 === 0 ? "reserve" : "exposure",
        index % 2 === 0 ? "Repair" : "Asset risk",
        300 + index * 4,
        "USD",
        1,
        300 + index * 4,
        index % 4 === 0 ? "Linked" : "Draft",
        projectId,
        `${projectId}-asset-1`,
        `incident-perf-${pad(((index - 1) % 60) + 1)}`,
        "user-paola",
        startDate,
        `Synthetic finance entry ${pad(index)}`,
        "Generated for performance profiling.",
        now,
        now,
      ]);
    }
  }

  for (let threadIndex = 1; threadIndex <= 12; threadIndex += 1) {
    const threadId = `thread-perf-${pad(threadIndex)}`;
    const activeMessageId = `${threadId}-message-16`;
    extraThreads.push([
      threadId,
      workspaceId,
      `Performance thread ${pad(threadIndex)}`,
      "/agents/chat",
      "Assistant chat",
      `Synthetic long-running assistant conversation ${pad(threadIndex)}.`,
      now,
      now,
      null,
    ]);

    extraThreadState.push([
      threadId,
      threadIndex % 4 === 0 ? "pending" : "idle",
      null,
      null,
      threadIndex % 2 === 0 ? "agent-supervisor" : "agent-assets",
      "support_request",
      threadIndex % 4 === 0 ? activeMessageId : null,
      null,
      JSON.stringify([`Synthetic question ${threadIndex}`]),
      null,
      null,
      null,
      "supervised",
      threadIndex === 1 ? 1 : 0,
      now,
    ]);

    for (let messageIndex = 1; messageIndex <= 16; messageIndex += 1) {
      extraMessages.push([
        `${threadId}-message-${messageIndex}`,
        threadId,
        messageIndex % 2 === 0 ? "assistant" : "user",
        `Synthetic chat message ${messageIndex} for ${threadId}. This message exists only to stress long local threads and scrolling state.`,
        messageIndex === 16 && threadIndex % 4 === 0 ? "pending" : "completed",
        null,
        now,
        now,
        null,
      ]);
    }
  }

  for (let runIndex = 1; runIndex <= 80; runIndex += 1) {
    const runId = `run-perf-${pad(runIndex)}`;
    const agentId = runIndex % 5 === 0 ? "agent-finance" : runIndex % 2 === 0 ? "agent-assets" : "agent-supervisor";
    extraAgentRuns.push([
      runId,
      workspaceId,
      agentId,
      "agent-supervisor",
      "desktop",
      `Synthetic run ${pad(runIndex)}`,
      "Synthetic profiling input summary.",
      "Synthetic profiling output summary.",
      runIndex % 11 === 0 ? "needs_approval" : runIndex % 7 === 0 ? "failed" : "completed",
      "supervised",
      runIndex % 11 === 0 ? 1 : 0,
      now,
      now,
      "manual",
      `thread-perf-${pad(((runIndex - 1) % 12) + 1)}`,
      runIndex % 11 === 0 ? "pending" : null,
      runIndex % 11 === 0 ? "session" : null,
      null,
      JSON.stringify({ synthetic: true, approvalReason: "Synthetic profiling draft." }),
    ]);

    extraAgentActivity.push([
      `activity-perf-${pad(runIndex)}`,
      workspaceId,
      agentId,
      runId,
      "sync",
      `Synthetic activity ${pad(runIndex)}`,
      "Generated to profile mission control feeds and recent activity rendering.",
      runIndex % 7 === 0 ? "critical" : runIndex % 5 === 0 ? "info" : "success",
      now,
      "manual",
      JSON.stringify({ synthetic: true }),
    ]);
  }

  db.exec("BEGIN");

  try {
    runBulkInsert(
      db,
      `
        INSERT INTO projects (
          id, workspace_id, code, name, client_name, status, start_date, end_date, description, created_at, updated_at, color_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraProjects,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO project_units (
          id, workspace_id, project_id, code, name, sort_order, status, status_source, color_key, start_date, end_date, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraUnits,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO assets (
          id, workspace_id, category_id, name, brand, model, serial_number, internal_code, description, purchase_date, purchase_price, currency,
          replacement_value, current_book_value, ownership_type, default_location_id, qr_code_value, notes, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraAssets,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO asset_assignments (
          id, workspace_id, asset_id, project_id, department_id, assigned_to_user_id, assigned_by_user_id, source_location_id, target_location_id,
          assignment_status, checked_out_at, expected_return_at, returned_at, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraAssignments,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO asset_events (
          id, workspace_id, asset_id, assignment_id, project_id, department_id, performed_by_user_id, event_type, location_id, from_location_id, to_location_id,
          event_timestamp, command_id, actor_type, source_channel, notes, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraEvents,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO asset_current_state (
          asset_id, workspace_id, current_location_id, current_project_id, current_department_id, current_responsible_user_id, active_assignment_id,
          condition_status, operational_status, custody_status, last_event_id, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraAssetState,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO incidents (
          id, workspace_id, asset_id, project_id, department_id, assignment_id, reported_by_user_id, incident_type, severity, status, title, description,
          reported_at, resolved_at, responsible_user_id, cost_estimate, currency, financial_status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraIncidents,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO packing_slips (
          id, workspace_id, project_id, department_id, prepared_by_user_id, approved_by_user_id, responsible_user_id, status, issue_date, return_due_date, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraPackingSlips,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO financial_entries (
          id, workspace_id, entry_type, category, amount, currency, exchange_rate, base_currency_amount, status, project_id, asset_id, incident_id,
          created_by_user_id, entry_date, description, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraFinanceEntries,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO assistant_chat_threads (
          id, workspace_id, title, context_key, context_label, summary_text, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraThreads,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO assistant_chat_thread_state (
          thread_id, last_state, last_error_code, last_error_summary, last_routed_agent_id, last_intent, active_message_id, previous_response_id,
          recent_user_messages_json, last_tool_result_summary, session_approval_agent_id, session_approval_granted_at, preferred_approval_mode, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraThreadState,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO assistant_chat_messages (
          id, thread_id, role, body, message_state, state_payload_json, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraMessages,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO agent_runs (
          id, workspace_id, agent_id, routed_by_agent_id, source_channel, title, input_summary, output_summary, status, approval_mode, approval_required,
          created_at, updated_at, source, thread_id, approval_decision, approval_scope, approval_decided_at, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraAgentRuns,
    );

    runBulkInsert(
      db,
      `
        INSERT INTO agent_activity_events (
          id, workspace_id, agent_id, run_id, kind, title, body, tone, created_at, source, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      extraAgentActivity,
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const cleanupPerformanceFoundationData = (db: DatabaseSync) => {
  const marker = db
    .prepare(
      `
        SELECT 1 AS present
        FROM projects
        WHERE workspace_id = ?
          AND id = 'project-perf-001'
        LIMIT 1
      `,
    )
    .get(workspaceId) as { present: number } | undefined;

  if (!marker) {
    return 0;
  }

  db.exec("BEGIN");

  try {
    const deleteByIdLike = (tableName: string, columnName = "id", pattern: string) =>
      Number(
        db
          .prepare(
            `
              DELETE FROM ${tableName}
              WHERE ${columnName} LIKE ?
            `,
          )
          .run(pattern).changes,
      );

    const deletedAttachments = Number(
      db
        .prepare(
          `
            DELETE FROM assistant_chat_attachments
            WHERE thread_id LIKE 'thread-perf-%'
          `,
        )
        .run().changes,
    );
    const deletedAgentActivity = Number(
      db
        .prepare(
          `
            DELETE FROM agent_activity_events
            WHERE id LIKE 'activity-perf-%'
               OR run_id LIKE 'run-perf-%'
          `,
        )
        .run().changes,
    );
    const deletedAgentRuns = deleteByIdLike("agent_runs", "id", "run-perf-%");
    const deletedThreadState = deleteByIdLike("assistant_chat_thread_state", "thread_id", "thread-perf-%");
    const deletedMessages = deleteByIdLike("assistant_chat_messages", "thread_id", "thread-perf-%");
    const deletedThreads = deleteByIdLike("assistant_chat_threads", "id", "thread-perf-%");
    const deletedFinanceEntries = deleteByIdLike("financial_entries", "id", "entry-perf-%");
    const deletedPackingSlipItems = Number(
      db
        .prepare(
          `
            DELETE FROM packing_slip_items
            WHERE packing_slip_id LIKE 'packing-perf-%'
          `,
        )
        .run().changes,
    );
    const deletedPackingSlips = deleteByIdLike("packing_slips", "id", "packing-perf-%");
    const deletedIncidents = deleteByIdLike("incidents", "id", "incident-perf-%");
    const deletedAssetState = deleteByIdLike("asset_current_state", "asset_id", "project-perf-%-asset-%");
    const deletedAssetEvents = deleteByIdLike("asset_events", "id", "project-perf-%-asset-%-event");
    const deletedAssetAssignments = deleteByIdLike("asset_assignments", "id", "project-perf-%-asset-%-assign");
    const deletedAssets = deleteByIdLike("assets", "id", "project-perf-%-asset-%");
    const deletedProjectUnits = deleteByIdLike("project_units", "id", "project-perf-%-unit-%");
    const deletedProjects = deleteByIdLike("projects", "id", "project-perf-%");

    db.exec("COMMIT");

    return (
      deletedAttachments +
      deletedThreadState +
      deletedMessages +
      deletedThreads +
      deletedAgentRuns +
      deletedAgentActivity +
      deletedFinanceEntries +
      deletedPackingSlipItems +
      deletedPackingSlips +
      deletedIncidents +
      deletedAssetState +
      deletedAssetEvents +
      deletedAssetAssignments +
      deletedAssets +
      deletedProjectUnits +
      deletedProjects
    );
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
