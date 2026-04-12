import { describe, expect, it } from "vitest";

import { createAssistantGatewayService } from "../../electron/main/services/ai/assistantGatewayService";
import { createAssistantGatewaySessionStore } from "../../electron/main/services/ai/assistantGatewaySessionStore";
import { createAgentToolRegistry } from "../../electron/main/services/ai/agentToolRegistry";
import { createAgentReadService } from "../../electron/main/services/data/agentReadService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createAgentMutationService } from "../../electron/main/services/data/agentMutationService";
import { createAssistantChatService } from "../../electron/main/services/data/assistantChatService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("assistant gateway service", () => {
  it("sends image attachments to OpenAI as multimodal input", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-gateway-images");
    const secrets = new Map<string, string>();
    const secretStore = {
      hasProviderSecret: (workspaceId: string, providerKey: string) => secrets.has(`${workspaceId}:${providerKey}`),
      getProviderSecret: (workspaceId: string, providerKey: string) => secrets.get(`${workspaceId}:${providerKey}`) ?? null,
      setProviderSecret: (workspaceId: string, providerKey: string, secret: string) => {
        secrets.set(`${workspaceId}:${providerKey}`, secret);
      },
      clearProviderSecret: (workspaceId: string, providerKey: string) => {
        secrets.delete(`${workspaceId}:${providerKey}`);
      },
    };

    const configMutations = createAgentMutationService(database, {
      secretStore,
      openaiProviderService: {
        createResponse: async () => ({
          ok: true as const,
          responseId: "noop",
          status: "completed",
          outputText: "{}",
          functionCalls: [],
        }),
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used while setting provider config.");
        },
        continueApprovedRun: async () => {
          throw new Error("Not used while setting provider config.");
        },
      },
    });

    configMutations.saveAIProviderConfig({
      commandId: "cmd-openai-config-images",
      workspaceId: "workspace-metadata",
      providerKey: "openai",
      enabled: true,
      apiKey: "sk-test",
      defaultModelKey: "openai:gpt-5.4",
      timeoutMs: 20000,
      retryCount: 1,
      baseUrl: "",
    });

    let capturedInput: string | Array<Record<string, unknown>> | null = null;
    const gateway = createAssistantGatewayService(database, {
      secretStore,
      sessionStore: createAssistantGatewaySessionStore(),
      toolRegistry: createAgentToolRegistry(createFoundationReadService(database), {
        getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      }),
      openaiProviderService: {
        createResponse: async (_config, input) => {
          if (!capturedInput) {
            capturedInput = input.input;
          }

          return {
            ok: true as const,
            responseId: "resp-image-1",
            status: "completed",
            outputText: JSON.stringify({
              intent: "inspect_attachment_context",
              target_agent: "supervisor-agent",
              confidence: 0.84,
              requires_approval: false,
              tool_call_requested: false,
              user_facing_summary: "Routed to Supervisor Agent. I reviewed the attached image and answered from supervised routing.",
              answer_kind: "informational",
              draft_run_title: null,
              draft_run_description: null,
            }),
            functionCalls: [],
          };
        },
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
    });

    const result = await gateway.sendMessage({
      commandId: "cmd-chat-image",
      workspaceId: "workspace-metadata",
      threadId: "thread-image-review",
      message: "Please review this equipment image.",
      attachments: [
        {
          id: "attachment-monitor",
          kind: "image",
          name: "monitor.png",
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

    expect(result.status).toBe("answered");
    expect(Array.isArray(capturedInput)).toBe(true);

    const multimodalInput = (capturedInput ?? []) as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const firstMessage = multimodalInput[0];
    const inputTextPart = firstMessage?.content.find((part) => part.type === "input_text");
    const inputImagePart = firstMessage?.content.find((part) => part.type === "input_image");

    expect(firstMessage?.role).toBe("user");
    expect(typeof inputTextPart?.text).toBe("string");
    expect((inputTextPart?.text as string)).toContain("Please review this equipment image.");
    expect((inputTextPart?.text as string)).toContain("monitor.png");
    expect(inputImagePart).toEqual({
      type: "input_image",
      image_url: "data:image/png;base64,ZmFrZS1kYXRh",
    });

    cleanup();
  });

  it("routes through a read-only tool and creates a supervised draft run", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-gateway");
    const secrets = new Map<string, string>();
    const secretStore = {
      hasProviderSecret: (workspaceId: string, providerKey: string) => secrets.has(`${workspaceId}:${providerKey}`),
      getProviderSecret: (workspaceId: string, providerKey: string) => secrets.get(`${workspaceId}:${providerKey}`) ?? null,
      setProviderSecret: (workspaceId: string, providerKey: string, secret: string) => {
        secrets.set(`${workspaceId}:${providerKey}`, secret);
      },
      clearProviderSecret: (workspaceId: string, providerKey: string) => {
        secrets.delete(`${workspaceId}:${providerKey}`);
      },
    };

    const configMutations = createAgentMutationService(database, {
      secretStore,
      openaiProviderService: {
        createResponse: async () => ({
          ok: true as const,
          responseId: "noop",
          status: "completed",
          outputText: "{}",
          functionCalls: [],
        }),
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used while setting provider config.");
        },
        continueApprovedRun: async () => {
          throw new Error("Not used while setting provider config.");
        },
      },
    });

    configMutations.saveAIProviderConfig({
      commandId: "cmd-openai-config",
      workspaceId: "workspace-metadata",
      providerKey: "openai",
      enabled: true,
      apiKey: "sk-test",
      defaultModelKey: "openai:gpt-5.4",
      timeoutMs: 20000,
      retryCount: 1,
      baseUrl: "",
    });

    const foundationReads = createFoundationReadService(database);
    const agentReads = createAgentReadService(database, secretStore);
    const sessionStore = createAssistantGatewaySessionStore();
    const toolRegistry = createAgentToolRegistry(foundationReads, {
      getRunsList: () => agentReads.getRunsList(),
    });

    let responseCount = 0;
    const gateway = createAssistantGatewayService(database, {
      secretStore,
      sessionStore,
      toolRegistry,
      openaiProviderService: {
        createResponse: async () => {
          responseCount += 1;

          if (responseCount === 1) {
            return {
              ok: true as const,
              responseId: "resp-1",
              status: "completed",
              outputText: "",
              functionCalls: [
                {
                  id: "fc-1",
                  call_id: "call-1",
                  name: "search_projects",
                  arguments: JSON.stringify({ query: "Aurora", limit: 2 }),
                  type: "function_call" as const,
                },
              ],
            };
          }

          return {
            ok: true as const,
            responseId: "resp-2",
            status: "completed",
            outputText: JSON.stringify({
              intent: "review_project_exposure",
              target_agent: "finance-agent",
              confidence: 0.92,
              requires_approval: true,
              tool_call_requested: true,
              user_facing_summary:
                "Routed to Finance Agent. I checked the matching project context and prepared a supervised draft to review the current exposure before any change is applied.",
              answer_kind: "draft_run",
              draft_run_title: "Review Aurora exposure",
              draft_run_description:
                "Review current operational exposure, incident cost estimates and linked finance entries for Aurora before any follow-up.",
            }),
            functionCalls: [],
          };
        },
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
    });

    const result = await gateway.sendMessage({
      commandId: "cmd-chat-real",
      workspaceId: "workspace-metadata",
      threadId: "thread-aurora",
      message: "Summarize the current operational exposure for Aurora and prepare a supervised review.",
      context: {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
      },
    });

    expect(result.status).toBe("draft_created");
    expect(result.routedAgentName).toBe("Finance Agent");
    expect(result.toolTraces[0]?.toolName).toBe("search_projects");
    expect(result.commandStateLabel).toContain("no changes made");

    const runRow = database
      .prepare("SELECT source, title, status FROM agent_runs WHERE id = ?")
      .get(result.draftRunId) as { source: string; title: string; status: string } | undefined;
    const activityRow = database
      .prepare("SELECT kind, source FROM agent_activity_events WHERE run_id = ? LIMIT 1")
      .get(result.draftRunId) as { kind: string; source: string } | undefined;

    expect(runRow).toEqual({
      source: "ai_gateway",
      title: "Review Aurora exposure",
      status: "needs_approval",
    });
    expect(activityRow).toEqual({
      kind: "ai_draft_run_created",
      source: "ai_gateway",
    });

    cleanup();
  });

  it("supports approve for this session and reuses that approval in the same thread", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-gateway-session-approval");
    const secrets = new Map<string, string>();
    const secretStore = {
      hasProviderSecret: (workspaceId: string, providerKey: string) => secrets.has(`${workspaceId}:${providerKey}`),
      getProviderSecret: (workspaceId: string, providerKey: string) => secrets.get(`${workspaceId}:${providerKey}`) ?? null,
      setProviderSecret: (workspaceId: string, providerKey: string, secret: string) => {
        secrets.set(`${workspaceId}:${providerKey}`, secret);
      },
      clearProviderSecret: (workspaceId: string, providerKey: string) => {
        secrets.delete(`${workspaceId}:${providerKey}`);
      },
    };

    const configMutations = createAgentMutationService(database, {
      secretStore,
      openaiProviderService: {
        createResponse: async () => ({
          ok: true as const,
          responseId: "noop",
          status: "completed",
          outputText: "{}",
          functionCalls: [],
        }),
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used while setting provider config.");
        },
        continueApprovedRun: async () => {
          throw new Error("Not used while setting provider config.");
        },
      },
    });

    configMutations.saveAIProviderConfig({
      commandId: "cmd-openai-config-session-approval",
      workspaceId: "workspace-metadata",
      providerKey: "openai",
      enabled: true,
      apiKey: "sk-test",
      defaultModelKey: "openai:gpt-5.4",
      timeoutMs: 20000,
      retryCount: 1,
      baseUrl: "",
    });

    let responseCount = 0;
    const gateway = createAssistantGatewayService(database, {
      secretStore,
      sessionStore: createAssistantGatewaySessionStore(),
      toolRegistry: createAgentToolRegistry(createFoundationReadService(database), {
        getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      }),
      openaiProviderService: {
        createResponse: async () => {
          responseCount += 1;

          return {
            ok: true as const,
            responseId: `resp-session-${responseCount}`,
            status: "completed",
            outputText: JSON.stringify({
              intent: "prepare_finance_review",
              target_agent: "finance-agent",
              confidence: 0.93,
              requires_approval: true,
              tool_call_requested: false,
              user_facing_summary:
                "Routed to Finance Agent. I prepared a supervised finance review draft before any change is applied.",
              answer_kind: "draft_run",
              draft_run_title: `Finance review ${responseCount}`,
              draft_run_description: "Review current operational exposure before any follow-up.",
            }),
            functionCalls: [],
          };
        },
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
    });

    const assistantChatService = createAssistantChatService(database, {
      attachmentsRootPath: "/tmp/bukowski-assistant-session-approval",
      assistantGatewayService: gateway,
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        recordFailure: () => undefined,
      },
    });

    const mutations = createAgentMutationService(database, {
      secretStore,
      openaiProviderService: {
        createResponse: async () => ({
          ok: true as const,
          responseId: "noop",
          status: "completed",
          outputText: "{}",
          functionCalls: [],
        }),
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
      assistantGatewayService: gateway,
      assistantChatService,
    });

    const threadSnapshot = assistantChatService.createThread({
      commandId: "cmd-thread-session-approval",
      workspaceId: "workspace-metadata",
      contextKey: "/finance",
      contextLabel: "Finance",
    });
    const threadId = threadSnapshot.activeThreadId ?? threadSnapshot.threads[0]?.id ?? "";

    const firstTurn = await assistantChatService.sendTurn({
      commandId: "cmd-turn-session-approval-1",
      workspaceId: "workspace-metadata",
      threadId,
      message: "Prepare a supervised finance review draft.",
      context: {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
      },
    });

    const firstAssistantMessage = firstTurn.threads[0]?.messages.at(-1);
    const firstDraftRunId = firstAssistantMessage?.meta?.draftRunId;

    expect(firstAssistantMessage?.meta?.approvalDecision).toBe("pending");
    expect(firstDraftRunId).toBeTruthy();

    const reviewResult = await mutations.reviewRun({
      commandId: "cmd-review-session-approval",
      workspaceId: "workspace-metadata",
      runId: firstDraftRunId ?? "",
      decision: "approve_for_session",
    });

    expect(reviewResult.approvalDecision).toBe("approved_for_session");
    expect(reviewResult.approvalScope).toBe("session");

    const threadState = database
      .prepare(
        `
          SELECT session_approval_agent_id, session_approval_granted_at
          FROM assistant_chat_thread_state
          WHERE thread_id = ?
        `,
      )
      .get(threadId) as { session_approval_agent_id: string | null; session_approval_granted_at: string | null } | undefined;

    expect(threadState?.session_approval_agent_id).toBeTruthy();
    expect(threadState?.session_approval_granted_at).toBeTruthy();

    const refreshedAfterReview = assistantChatService.getSnapshot();
    const reviewedAssistantMessage = refreshedAfterReview.threads[0]?.messages.at(-1);
    expect(reviewedAssistantMessage?.meta?.approvalDecision).toBe("approved_for_session");

    const secondTurn = await assistantChatService.sendTurn({
      commandId: "cmd-turn-session-approval-2",
      workspaceId: "workspace-metadata",
      threadId,
      message: "Prepare another supervised finance review draft.",
      context: {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
      },
    });

    const secondAssistantMessage = secondTurn.threads[0]?.messages.at(-1);
    const secondDraftRunId = secondAssistantMessage?.meta?.draftRunId;

    expect(secondAssistantMessage?.meta?.approvalDecision).toBe("approved_for_session");
    expect(secondAssistantMessage?.meta?.approvalScope).toBe("session");

    const secondRun = database
      .prepare(
        `
          SELECT status, approval_decision, approval_scope
          FROM agent_runs
          WHERE id = ?
        `,
      )
      .get(secondDraftRunId ?? "") as
      | { status: string; approval_decision: string | null; approval_scope: string | null }
      | undefined;

    expect(secondRun).toEqual({
      status: "approved",
      approval_decision: "approved_for_session",
      approval_scope: "session",
    });

    cleanup();
  });

  it("respects unsupervised thread preference without re-prompting for approval on supervised drafts", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-gateway-unsupervised");
    const secrets = new Map<string, string>();
    const secretStore = {
      hasProviderSecret: (workspaceId: string, providerKey: string) => secrets.has(`${workspaceId}:${providerKey}`),
      getProviderSecret: (workspaceId: string, providerKey: string) => secrets.get(`${workspaceId}:${providerKey}`) ?? null,
      setProviderSecret: (workspaceId: string, providerKey: string, secret: string) => {
        secrets.set(`${workspaceId}:${providerKey}`, secret);
      },
      clearProviderSecret: (workspaceId: string, providerKey: string) => {
        secrets.delete(`${workspaceId}:${providerKey}`);
      },
    };

    const configMutations = createAgentMutationService(database, {
      secretStore,
      openaiProviderService: {
        createResponse: async () => ({
          ok: true as const,
          responseId: "noop",
          status: "completed",
          outputText: "{}",
          functionCalls: [],
        }),
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used while setting provider config.");
        },
        continueApprovedRun: async () => {
          throw new Error("Not used while setting provider config.");
        },
      },
    });

    configMutations.saveAIProviderConfig({
      commandId: "cmd-openai-config-unsupervised",
      workspaceId: "workspace-metadata",
      providerKey: "openai",
      enabled: true,
      apiKey: "sk-test",
      defaultModelKey: "openai:gpt-5.4",
      timeoutMs: 20000,
      retryCount: 1,
      baseUrl: "",
    });

    const gateway = createAssistantGatewayService(database, {
      secretStore,
      sessionStore: createAssistantGatewaySessionStore(),
      toolRegistry: createAgentToolRegistry(createFoundationReadService(database), {
        getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      }),
      openaiProviderService: {
        createResponse: async () => ({
          ok: true as const,
          responseId: "resp-unsupervised",
          status: "completed",
            outputText: JSON.stringify({
            intent: "prepare_incident_review",
            target_agent: "incidents-maintenance-agent",
            confidence: 0.93,
            requires_approval: false,
            tool_call_requested: false,
            user_facing_summary: "Prepared the incident review draft.",
            answer_kind: "draft_run",
            draft_run_title: "Incident review",
            draft_run_description: "Review current incident exposure before any follow-up.",
          }),
          functionCalls: [],
        }),
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
    });

    const result = await gateway.sendMessage({
      commandId: "cmd-chat-unsupervised",
      workspaceId: "workspace-metadata",
      threadId: "thread-unsupervised",
      message: "Prepare an incident review draft without asking again.",
      context: {
        workspaceId: "workspace-metadata",
        activePath: "/incidents",
        currentView: "Incidents",
        requestedApprovalMode: "unsupervised",
      },
    });

    expect(result.status).toBe("draft_created");
    expect(result.approvalDecision).toBeNull();

    const runRow = database
      .prepare("SELECT status, approval_required FROM agent_runs WHERE id = ?")
      .get(result.draftRunId) as { status: string; approval_required: number } | undefined;

    expect(runRow).toEqual({
      status: "queued",
      approval_required: 0,
    });

    cleanup();
  });
});
