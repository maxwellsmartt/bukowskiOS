import type { DatabaseSync } from "node:sqlite";

type MemoryKind = "instruction" | "preference" | "stable_fact" | "product_feedback" | "bug_finding" | "glossary";
type MemoryStatus = "active" | "superseded" | "archived";
type MemorySourceReason =
  | "user_explicit_instruction"
  | "repeated_preference"
  | "stable_operational_fact"
  | "project_specific_fact"
  | "manual_promotion"
  | "system_reviewed_bug_signal"
  | "system_reviewed_product_signal";

type MemoryEntry = {
  id: string;
  body: string;
  kind: MemoryKind;
  agentId: string | null;
  projectId: string | null;
  sourceReason: MemorySourceReason;
  confidence: number;
  updatedAt: string;
};

type MemoryCandidate = Omit<MemoryEntry, "id" | "updatedAt">;

const maxCandidatesPerTurn = 3;
const workspaceId = "workspace-metadata";

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizeKey = (kind: MemoryKind, agentId: string | null, projectId: string | null, body: string) =>
  `${kind}|${agentId ?? "-"}|${projectId ?? "-"}|${normalizeWhitespace(body).toLowerCase()}`;

const truncate = (value: string, max = 220) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

const queryFragment = (value: string) => {
  const normalized = normalizeWhitespace(value);
  return normalized ? `%${normalized.toLowerCase()}%` : null;
};

const addEvent = (
  db: DatabaseSync,
  args: {
    entryId: string | null;
    threadId: string | null;
    messageId: string | null;
    eventKind: string;
    status: "created" | "merged" | "skipped" | "failed";
    sourceReason: MemorySourceReason;
    body: string;
  },
) => {
  db.prepare(
    `
      INSERT INTO assistant_memory_events (
        id,
        workspace_id,
        entry_id,
        thread_id,
        message_id,
        event_kind,
        status,
        source_reason,
        body,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    `memory-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    args.entryId,
    args.threadId,
    args.messageId,
    args.eventKind,
    args.status,
    args.sourceReason,
    truncate(args.body, 320),
    new Date().toISOString(),
  );
};

const matchCandidate = (message: string, context: { activeProjectId?: string | null }, routedAgentId: string | null): MemoryCandidate[] => {
  const normalized = normalizeWhitespace(message);
  const lower = normalized.toLowerCase();
  const candidates: MemoryCandidate[] = [];

  const pushCandidate = (candidate: MemoryCandidate) => {
    if (!candidate.body || candidates.length >= maxCandidatesPerTurn) {
      return;
    }

    candidates.push({
      ...candidate,
      body: truncate(normalizeWhitespace(candidate.body)),
    });
  };

  if (/(remember|from now on|always|never)\b/i.test(normalized)) {
    pushCandidate({
      body: normalized,
      kind: "instruction",
      agentId: routedAgentId,
      projectId: null,
      sourceReason: "user_explicit_instruction",
      confidence: 0.94,
    });
  }

  if (/(i prefer|prefer that|please answer|call me)\b/i.test(lower)) {
    pushCandidate({
      body: normalized,
      kind: "preference",
      agentId: routedAgentId,
      projectId: null,
      sourceReason: "repeated_preference",
      confidence: 0.88,
    });
  }

  if (/(my name is|we use|our workspace uses|this project uses|means that)\b/i.test(lower)) {
    pushCandidate({
      body: normalized,
      kind: "stable_fact",
      agentId: routedAgentId,
      projectId: context.activeProjectId ?? null,
      sourceReason: context.activeProjectId ? "project_specific_fact" : "stable_operational_fact",
      confidence: context.activeProjectId ? 0.84 : 0.8,
    });
  }

  return candidates.slice(0, maxCandidatesPerTurn);
};

export const createAssistantMemoryService = (db: DatabaseSync) => {
  const selectEntries = (args: {
    query: string;
    limit: number;
    where: string;
    params: Array<string | null>;
  }) =>
    db
      .prepare(
        `
          SELECT
            id,
            body,
            kind,
            agent_id,
            project_id,
            source_reason,
            confidence,
            updated_at
          FROM assistant_memory_entries
          WHERE workspace_id = ?
            AND status = 'active'
            AND ${args.where}
            AND (? IS NULL OR lower(body) LIKE ?)
          ORDER BY updated_at DESC
          LIMIT ${args.limit}
        `,
      )
      .all(workspaceId, ...args.params, queryFragment(args.query), queryFragment(args.query)) as Array<{
      id: string;
      body: string;
      kind: MemoryKind;
      agent_id: string | null;
      project_id: string | null;
      source_reason: MemorySourceReason;
      confidence: number;
      updated_at: string;
    }>;

  const toEntry = (row: {
    id: string;
    body: string;
    kind: MemoryKind;
    agent_id: string | null;
    project_id: string | null;
    source_reason: MemorySourceReason;
    confidence: number;
    updated_at: string;
  }): MemoryEntry => ({
    id: row.id,
    body: row.body,
    kind: row.kind,
    agentId: row.agent_id,
    projectId: row.project_id,
    sourceReason: row.source_reason,
    confidence: row.confidence,
    updatedAt: row.updated_at,
  });

  const upsertMemory = (candidate: MemoryCandidate, source: { threadId: string; messageId: string | null }) => {
    const normalized = normalizeKey(candidate.kind, candidate.agentId, candidate.projectId, candidate.body);
    const existing = db
      .prepare(
        `
          SELECT id
          FROM assistant_memory_entries
          WHERE workspace_id = ?
            AND normalized_key = ?
            AND status = 'active'
          LIMIT 1
        `,
      )
      .get(workspaceId, normalized) as { id: string } | undefined;

    const now = new Date().toISOString();

    if (existing) {
      db.prepare(
        `
          UPDATE assistant_memory_entries
          SET confidence = MAX(confidence, ?),
              updated_at = ?
          WHERE id = ?
        `,
      ).run(candidate.confidence, now, existing.id);

      addEvent(db, {
        entryId: existing.id,
        threadId: source.threadId,
        messageId: source.messageId,
        eventKind: "memory_candidate_merged",
        status: "merged",
        sourceReason: candidate.sourceReason,
        body: candidate.body,
      });
      return;
    }

    const id = `memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `
        INSERT INTO assistant_memory_entries (
          id,
          workspace_id,
          agent_id,
          project_id,
          kind,
          body,
          normalized_key,
          confidence,
          source_thread_id,
          source_message_id,
          source_reason,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `,
    ).run(
      id,
      workspaceId,
      candidate.agentId,
      candidate.projectId,
      candidate.kind,
      candidate.body,
      normalized,
      candidate.confidence,
      source.threadId,
      source.messageId,
      candidate.sourceReason,
      now,
      now,
    );

    addEvent(db, {
      entryId: id,
      threadId: source.threadId,
      messageId: source.messageId,
      eventKind: "memory_candidate_created",
      status: "created",
      sourceReason: candidate.sourceReason,
      body: candidate.body,
    });
  };

  return {
    extractAndPersist(args: {
      message: string;
      context: { activeProjectId?: string | null };
      threadId: string;
      messageId: string | null;
      routedAgentId: string | null;
    }) {
      const candidates = matchCandidate(args.message, args.context, args.routedAgentId);

      candidates.forEach((candidate) => {
        if (candidate.kind === "product_feedback" || candidate.kind === "bug_finding" || candidate.kind === "glossary") {
          addEvent(db, {
            entryId: null,
            threadId: args.threadId,
            messageId: args.messageId,
            eventKind: "memory_candidate_skipped",
            status: "skipped",
            sourceReason: candidate.sourceReason,
            body: candidate.body,
          });
          return;
        }

        upsertMemory(candidate, {
          threadId: args.threadId,
          messageId: args.messageId,
        });
      });
    },
    recordFailure(args: {
      threadId: string;
      messageId: string | null;
      sourceReason: MemorySourceReason;
      body: string;
    }) {
      addEvent(db, {
        entryId: null,
        threadId: args.threadId,
        messageId: args.messageId,
        eventKind: "memory_extraction_failed",
        status: "failed",
        sourceReason: args.sourceReason,
        body: args.body,
      });
    },
    getOverlay(args: {
      agentId: string | null;
      projectId: string | null;
      query: string;
      limit?: number;
    }) {
      const limit = Math.max(1, Math.min(args.limit ?? 6, 12));
      const agentEntries =
        args.agentId === null
          ? []
          : selectEntries({
              query: args.query,
              limit: Math.min(2, limit),
              where: "agent_id = ? AND project_id IS NULL",
              params: [args.agentId],
            }).map(toEntry);
      const workspaceEntries = selectEntries({
        query: args.query,
        limit: Math.min(2, limit),
        where: "agent_id IS NULL AND project_id IS NULL",
        params: [],
      }).map(toEntry);
      const projectEntries = args.projectId
        ? selectEntries({
            query: args.query,
            limit: Math.min(2, limit),
            where: "project_id = ?",
            params: [args.projectId],
          }).map(toEntry)
        : [];

      return {
        agentEntries,
        workspaceEntries,
        projectEntries,
        all: [...agentEntries, ...workspaceEntries, ...projectEntries].slice(0, limit),
      };
    },
    pruneStaleEntries(args?: {
      maxAgeDays?: number;
      maxCount?: number;
      minConfidence?: number;
    }) {
      const maxAgeDays = Math.max(1, args?.maxAgeDays ?? 30);
      const maxCount = Math.max(50, args?.maxCount ?? 500);
      const minConfidence = args?.minConfidence ?? 0.5;
      const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      db.prepare(
        `
          UPDATE assistant_memory_entries
          SET status = 'archived',
              updated_at = ?
          WHERE workspace_id = ?
            AND status = 'active'
            AND confidence < ?
            AND updated_at < ?
        `,
      ).run(now, workspaceId, minConfidence, cutoff);

      const activeRows = db
        .prepare(
          `
            SELECT id
            FROM assistant_memory_entries
            WHERE workspace_id = ?
              AND status = 'active'
            ORDER BY updated_at DESC
          `,
        )
        .all(workspaceId) as Array<{ id: string }>;

      if (activeRows.length <= maxCount) {
        return;
      }

      const rowsToArchive = activeRows.slice(maxCount);
      const archiveStatement = db.prepare(
        `
          UPDATE assistant_memory_entries
          SET status = 'archived',
              updated_at = ?
          WHERE id = ?
        `,
      );

      rowsToArchive.forEach((row) => {
        archiveStatement.run(now, row.id);
      });
    },
  };
};

export type AssistantMemoryService = ReturnType<typeof createAssistantMemoryService>;
