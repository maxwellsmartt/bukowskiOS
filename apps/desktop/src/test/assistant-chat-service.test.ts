import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createAssistantChatService } from "../../electron/main/services/data/assistantChatService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const createAttachmentsRoot = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));

describe("assistant chat service", () => {
  it("creates durable threads and restores the active thread from persisted state", () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-chat-thread");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-assistant-chat-thread");
    const service = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used in this test.");
        },
        generateThreadTitle: async () => null,
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });

    const created = service.createThread({
      commandId: "cmd-thread-create",
      workspaceId: "workspace-metadata",
      contextKey: "/agents/mission-control",
      contextLabel: "Agents",
    });

    expect(created.activeThreadId).toBeTruthy();
    expect(created.threads).toHaveLength(1);
    expect(created.threads[0]?.messages[0]?.body).toContain("Supervisor ready");

    const reloaded = service.getSnapshot();
    expect(reloaded.activeThreadId).toBe(created.activeThreadId);
    expect(reloaded.threads[0]?.contextLabel).toBe("Agents");

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("persists image attachments, downgrades missing files, and cleans them up on delete", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-chat-attachments");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-assistant-chat-attachments");
    const service = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async () => ({
          status: "answered" as const,
          stateLabel: "Routed to Supervisor Agent",
          stateBody: "Supervisor Agent answered directly from supervised routing.",
          assistantMessage: "I reviewed the attached image.",
          routedAgentId: "agent-supervisor",
          routedAgentName: "Supervisor Agent",
          routedAgentRole: "Supervisor Agent",
          intentLabel: "Image review request",
          commandStateLabel: "No changes applied",
          draftRunId: null,
          providerKey: "openai",
          modelKey: "openai:gpt-5.4",
          toolTraces: [],
          orchestration: {
            intent: "review_image",
            targetAgentId: "supervisor-agent",
            targetAgentName: "Supervisor Agent",
            confidence: 0.91,
            requiresApproval: false,
            toolCallRequested: false,
            toolCalls: [],
            userFacingSummary: "Reviewed the attached image.",
            answerKind: "informational",
            draftRunTitle: null,
            draftRunDescription: null,
          },
          operationalReceipt: {
            summary: "1 lookup step(s) completed.",
            completed: [{ label: "Review image", status: "done", detail: "Image was reviewed." }],
            blocked: [],
            pending: [],
            nextSteps: ["No follow-up required."],
          },
        }),
        generateThreadTitle: async () => null,
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });

    const created = service.createThread({
      commandId: "cmd-thread-create-attachments",
      workspaceId: "workspace-metadata",
      contextKey: "/assets",
      contextLabel: "Assets",
    });
    const threadId = created.activeThreadId ?? created.threads[0]?.id;

    expect(threadId).toBeTruthy();

    await service.sendTurn({
      commandId: "cmd-turn-attachments",
      workspaceId: "workspace-metadata",
      threadId: threadId ?? "",
      message: "Review this image",
      attachments: [
        {
          id: "attachment-image-test",
          kind: "image",
          name: "test-image.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,ZmFrZS1kYXRh",
        },
      ],
      context: {
        workspaceId: "workspace-metadata",
        activePath: "/assets",
        currentView: "Assets",
      },
    });

    const attachmentRow = database
      .prepare(
        `
          SELECT id, storage_path, status
          FROM assistant_chat_attachments
          WHERE thread_id = ?
          LIMIT 1
        `,
      )
      .get(threadId) as { id: string; storage_path: string; status: string } | undefined;

    expect(attachmentRow).toBeTruthy();
    expect(attachmentRow?.status).toBe("available");
    expect(fs.existsSync(attachmentRow?.storage_path ?? "")).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(attachmentRow!.storage_path).mode & 0o777).toBe(0o600);
    }

    fs.unlinkSync(attachmentRow?.storage_path ?? "");
    const snapshotWithMissingAttachment = service.getSnapshot();
    expect(snapshotWithMissingAttachment.threads[0]?.messages[1]?.attachments[0]?.status).toBe("missing");
    expect(snapshotWithMissingAttachment.threads[0]?.messages[2]?.meta?.operationalReceipt?.summary).toBe(
      "1 lookup step(s) completed.",
    );

    service.deleteThread({
      commandId: "cmd-thread-delete-attachments",
      workspaceId: "workspace-metadata",
      threadId: threadId ?? "",
    });

    const deletedAttachment = database
      .prepare(
        `
          SELECT status, deleted_at
          FROM assistant_chat_attachments
          WHERE id = ?
        `,
      )
      .get(attachmentRow?.id ?? "") as { status: string; deleted_at: string | null } | undefined;

    expect(deletedAttachment?.status).toBe("deleted");
    expect(deletedAttachment?.deleted_at).toBeTruthy();

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("reconciles interrupted pending turns on restart", () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-chat-interrupted");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-assistant-chat-interrupted");
    const service = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used in this test.");
        },
        generateThreadTitle: async () => null,
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });

    const created = service.createThread({
      commandId: "cmd-thread-create-interrupted",
      workspaceId: "workspace-metadata",
      contextKey: "/agents/mission-control",
      contextLabel: "Agents",
    });
    const threadId = created.activeThreadId ?? created.threads[0]?.id ?? "";

    database
      .prepare(
        `
          INSERT INTO assistant_chat_messages (
            id,
            thread_id,
            role,
            body,
            message_state,
            state_payload_json,
            created_at,
            updated_at,
            deleted_at
          ) VALUES ('assistant-pending-test', ?, 'assistant', '', 'pending', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
        `,
      )
      .run(threadId);

    database
      .prepare(
        `
          UPDATE assistant_chat_thread_state
          SET last_state = 'pending',
              active_message_id = 'assistant-pending-test'
          WHERE thread_id = ?
        `,
      )
      .run(threadId);

    service.reconcileInterruptedThreads();
    const snapshot = service.getSnapshot();
    const interruptedThread = snapshot.threads.find((thread) => thread.id === threadId);
    const interruptedMessage = interruptedThread?.messages.find((message) => message.id === "assistant-pending-test");

    expect(interruptedThread?.state).toBe("interrupted");
    expect(interruptedThread?.lastErrorSummary).toContain("interrupted");
    expect(interruptedMessage?.state).toBe("error");
    expect(interruptedMessage?.body).toContain("interrupted");

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("persists per-thread approval preferences", () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-chat-preferences");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-assistant-chat-preferences");
    const service = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used in this test.");
        },
        generateThreadTitle: async () => null,
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });

    const created = service.createThread({
      commandId: "cmd-thread-create-preferences",
      workspaceId: "workspace-metadata",
      contextKey: "/agents",
      contextLabel: "Agents",
    });
    const threadId = created.activeThreadId ?? created.threads[0]?.id ?? "";

    const updated = service.updateThreadPreferences({
      commandId: "cmd-thread-preferences",
      workspaceId: "workspace-metadata",
      threadId,
      preferredApprovalMode: "unsupervised",
    });

    expect(updated.threads[0]?.preferredApprovalMode).toBe("unsupervised");

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });
});
