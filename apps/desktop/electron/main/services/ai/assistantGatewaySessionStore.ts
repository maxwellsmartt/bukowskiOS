import type { DatabaseSync } from "node:sqlite";

import { LOCAL_FALLBACK_WORKSPACE_ID } from "@contracts";

// Session lifetime for reusing the provider's server-side conversation state
// (previousResponseId) and the cached recent-message snapshot. The old 1h
// window dropped context mid-day; 72h survives nights and weekends so a thread
// the user returns to stays warm. Continuity itself no longer depends on this —
// the gateway rebuilds a transcript from persisted messages every turn — but a
// longer window keeps the cheaper server-side state in play.
const defaultTimeoutMs = 72 * 60 * 60 * 1000;

type SessionSummary = {
  previousResponseId: string | null;
  recentUserMessages: string[];
  lastIntent: string | null;
  lastTargetAgent: string | null;
  lastToolResultSummary: string | null;
  lastStatus: string | null;
  lastError: string | null;
  updatedAt: number;
};

export type AssistantGatewaySessionSnapshot = SessionSummary & {
  isExpired: boolean;
};

const appendRecentMessage = (messages: string[], nextMessage: string) => [...messages, nextMessage].slice(-3);

const parseRecentMessages = (value: string | null | undefined) => {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
};

const hasDurableThread = (db: DatabaseSync | null, workspaceId: string, threadId: string) => {
  if (!db) {
    return false;
  }

  const row = db
    .prepare(
      `
        SELECT id
        FROM assistant_chat_threads
        WHERE workspace_id = ?
          AND id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `,
    )
    .get(workspaceId, threadId) as { id: string } | undefined;

  return Boolean(row);
};

export const createAssistantGatewaySessionStore = (db: DatabaseSync | null = null, timeoutMs = defaultTimeoutMs) => {
  const sessions = new Map<string, SessionSummary>();

  const buildKey = (workspaceId: string, threadId: string) => `${workspaceId}:${threadId}`;

  const readFallback = (workspaceId: string, threadId: string): AssistantGatewaySessionSnapshot => {
    const session = sessions.get(buildKey(workspaceId, threadId));

    if (!session) {
      return {
        previousResponseId: null,
        recentUserMessages: [],
        lastIntent: null,
        lastTargetAgent: null,
        lastToolResultSummary: null,
        lastStatus: null,
        lastError: null,
        updatedAt: 0,
        isExpired: false,
      };
    }

    const isExpired = Date.now() - session.updatedAt > timeoutMs;

    if (isExpired) {
      sessions.delete(buildKey(workspaceId, threadId));
      return {
        previousResponseId: null,
        recentUserMessages: [],
        lastIntent: null,
        lastTargetAgent: null,
        lastToolResultSummary: null,
        lastStatus: null,
        lastError: null,
        updatedAt: 0,
        isExpired: true,
      };
    }

    return {
      ...session,
      isExpired: false,
    };
  };

  const readDurable = (workspaceId: string, threadId: string): AssistantGatewaySessionSnapshot => {
    const row = db
      ?.prepare(
        `
          SELECT
            previous_response_id,
            recent_user_messages_json,
            last_intent,
            last_tool_result_summary,
            last_state,
            last_error_summary,
            updated_at,
            (
              SELECT agent_key
              FROM agents
              WHERE id = assistant_chat_thread_state.last_routed_agent_id
              LIMIT 1
            ) AS routed_agent_key
          FROM assistant_chat_thread_state
          WHERE thread_id = ?
          LIMIT 1
        `,
      )
      .get(threadId) as
      | {
          previous_response_id: string | null;
          recent_user_messages_json: string | null;
          last_intent: string | null;
          last_tool_result_summary: string | null;
          last_state: string | null;
          last_error_summary: string | null;
          updated_at: string | null;
          routed_agent_key: string | null;
        }
      | undefined;

    if (!row) {
      return {
        previousResponseId: null,
        recentUserMessages: [],
        lastIntent: null,
        lastTargetAgent: null,
        lastToolResultSummary: null,
        lastStatus: null,
        lastError: null,
        updatedAt: 0,
        isExpired: false,
      };
    }

    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const isExpired = updatedAt > 0 ? Date.now() - updatedAt > timeoutMs : false;

    return {
      previousResponseId: isExpired ? null : row.previous_response_id,
      recentUserMessages: isExpired ? [] : parseRecentMessages(row.recent_user_messages_json),
      lastIntent: isExpired ? null : row.last_intent,
      lastTargetAgent: isExpired ? null : row.routed_agent_key,
      lastToolResultSummary: isExpired ? null : row.last_tool_result_summary,
      lastStatus: isExpired ? null : row.last_state,
      lastError: isExpired ? null : row.last_error_summary,
      updatedAt: isExpired ? 0 : updatedAt,
      isExpired,
    };
  };

  const writeDurable = (
    threadId: string,
    nextValue: {
      previousResponseId: string | null;
      recentUserMessages: string[];
      lastIntent: string | null;
      lastTargetAgent: string | null;
      lastToolResultSummary: string | null;
      lastStatus: string | null;
      lastError: string | null;
    },
  ) => {
    if (!db) {
      return;
    }

    const routedAgentId =
      nextValue.lastTargetAgent
        ? ((db
            .prepare(
              `
                SELECT id
                FROM agents
                WHERE workspace_id = ?
                  AND agent_key = ?
                LIMIT 1
              `,
            )
            .get(LOCAL_FALLBACK_WORKSPACE_ID, nextValue.lastTargetAgent) as { id: string } | undefined)?.id ?? null)
        : null;

    db.prepare(
      `
        INSERT INTO assistant_chat_thread_state (
          thread_id,
          last_state,
          last_error_summary,
          last_routed_agent_id,
          last_intent,
          previous_response_id,
          recent_user_messages_json,
          last_tool_result_summary,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          last_state = excluded.last_state,
          last_error_summary = excluded.last_error_summary,
          last_routed_agent_id = excluded.last_routed_agent_id,
          last_intent = excluded.last_intent,
          previous_response_id = excluded.previous_response_id,
          recent_user_messages_json = excluded.recent_user_messages_json,
          last_tool_result_summary = excluded.last_tool_result_summary,
          updated_at = excluded.updated_at
      `,
    ).run(
      threadId,
      nextValue.lastStatus ?? "idle",
      nextValue.lastError,
      routedAgentId,
      nextValue.lastIntent,
      nextValue.previousResponseId,
      JSON.stringify(nextValue.recentUserMessages),
      nextValue.lastToolResultSummary,
      new Date().toISOString(),
    );
  };

  return {
    timeoutMs,
    read(workspaceId: string, threadId: string) {
      if (hasDurableThread(db, workspaceId, threadId)) {
        return readDurable(workspaceId, threadId);
      }

      return readFallback(workspaceId, threadId);
    },
    touchMessage(workspaceId: string, threadId: string, message: string) {
      const current = this.read(workspaceId, threadId);
      const nextValue = {
        previousResponseId: current.previousResponseId,
        recentUserMessages: appendRecentMessage(current.recentUserMessages, message),
        lastIntent: current.lastIntent,
        lastTargetAgent: current.lastTargetAgent,
        lastToolResultSummary: current.lastToolResultSummary,
        lastStatus: current.lastStatus,
        lastError: current.lastError,
      };

      if (hasDurableThread(db, workspaceId, threadId)) {
        writeDurable(threadId, nextValue);
        return;
      }

      sessions.set(buildKey(workspaceId, threadId), {
        ...nextValue,
        updatedAt: Date.now(),
      });
    },
    writeResult(
      workspaceId: string,
      threadId: string,
      result: {
        previousResponseId: string | null;
        intent: string | null;
        targetAgent: string | null;
        toolResultSummary: string | null;
        status: string;
        error: string | null;
      },
    ) {
      const current = this.read(workspaceId, threadId);
      const nextValue = {
        previousResponseId: result.previousResponseId,
        recentUserMessages: current.recentUserMessages,
        lastIntent: result.intent,
        lastTargetAgent: result.targetAgent,
        lastToolResultSummary: result.toolResultSummary,
        lastStatus: result.status,
        lastError: result.error,
      };

      if (hasDurableThread(db, workspaceId, threadId)) {
        writeDurable(threadId, nextValue);
        return;
      }

      sessions.set(buildKey(workspaceId, threadId), {
        ...nextValue,
        updatedAt: Date.now(),
      });
    },
    clear(workspaceId: string, threadId: string) {
      if (hasDurableThread(db, workspaceId, threadId) && db) {
        db.prepare("DELETE FROM assistant_chat_thread_state WHERE thread_id = ?").run(threadId);
      }

      sessions.delete(buildKey(workspaceId, threadId));
    },
    clearAll() {
      if (db) {
        db.prepare("DELETE FROM assistant_chat_thread_state").run();
      }

      sessions.clear();
    },
  };
};

export type AssistantGatewaySessionStore = ReturnType<typeof createAssistantGatewaySessionStore>;
