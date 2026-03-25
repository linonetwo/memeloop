import { describe, expect, it, vi } from "vitest";

import { handleRpc, type RpcHandlerContext } from "../rpcHandlers.js";

function mockCtx(over: Partial<RpcHandlerContext> = {}): RpcHandlerContext {
  const storage = {
    listConversations: vi.fn().mockResolvedValue([
      {
        conversationId: "c1",
        originNodeId: "peer-a",
        lastMessageTimestamp: 200,
        title: "t",
        lastMessagePreview: "",
        messageCount: 1,
        definitionId: "d",
        isUserInitiated: true,
      },
    ]),
    getMessages: vi.fn().mockResolvedValue([
      {
        messageId: "m-new",
        conversationId: "c1",
        originNodeId: "local",
        timestamp: 1,
        lamportClock: 1,
        role: "user" as const,
        content: "x",
      },
    ]),
    appendMessage: vi.fn(),
    upsertConversationMetadata: vi.fn(),
    insertMessagesIfAbsent: vi.fn(),
    getAttachment: vi.fn().mockResolvedValue({
      contentHash: "h1",
      filename: "f.bin",
      mimeType: "application/octet-stream",
      size: 3,
    }),
    saveAttachment: vi.fn(),
    getAgentDefinition: vi.fn(),
    saveAgentInstance: vi.fn(),
    getConversationMeta: vi.fn(),
    readAttachmentData: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
  const runtime = {
    createAgent: vi.fn().mockResolvedValue({ conversationId: "new-c" }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    cancelAgent: vi.fn().mockResolvedValue(undefined),
    subscribeToUpdates: vi.fn().mockReturnValue(() => {}),
  };
  return {
    runtime: runtime as RpcHandlerContext["runtime"],
    storage: storage as RpcHandlerContext["storage"],
    nodeId: "node-self",
    agentDefinitions: [
      {
        id: "agent-1",
        name: "A",
        description: "",
        systemPrompt: "",
        tools: [],
        version: "1",
      },
    ],
    ...over,
  };
}

describe("handleRpc", () => {
  it("memeloop.auth.handshake returns nodeId", async () => {
    const r = (await handleRpc(mockCtx(), "memeloop.auth.handshake", {})) as { ok?: boolean; nodeId?: string };
    expect(r.ok).toBe(true);
    expect(r.nodeId).toBe("node-self");
  });

  it("memeloop.agent.getDefinitions returns YAML definitions", async () => {
    const r = (await handleRpc(mockCtx(), "memeloop.agent.getDefinitions", {})) as {
      definitions?: Array<{ id?: string }>;
    };
    expect(r.definitions?.[0]?.id).toBe("agent-1");
  });

  it("memeloop.sync.pullMissingMessages filters known ids", async () => {
    const r = (await handleRpc(
      mockCtx(),
      "memeloop.sync.pullMissingMessages",
      { conversationId: "c1", knownMessageIds: ["m-new"] },
    )) as { messages?: unknown[] };
    expect(r.messages).toEqual([]);
  });

  it("memeloop.storage.getAttachmentBlob returns base64 when readAttachmentData set", async () => {
    const r = (await handleRpc(mockCtx(), "memeloop.storage.getAttachmentBlob", {
      contentHash: "h1",
    })) as { found?: boolean; dataBase64?: string };
    expect(r.found).toBe(true);
    expect(r.dataBase64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("memeloop.node.getInfo exposes wikis when wikiManager absent", async () => {
    const r = (await handleRpc(mockCtx(), "memeloop.node.getInfo", {})) as {
      capabilities?: { wikis?: unknown[]; hasWiki?: boolean };
    };
    expect(r.capabilities?.hasWiki).toBe(false);
    expect(r.capabilities?.wikis).toEqual([]);
  });

  it("memeloop.terminal.follow proxies terminal manager", async () => {
    const terminalManager = {
      follow: vi.fn().mockResolvedValue({
        sessionId: "s1",
        status: "running",
        exitCode: null,
        nextSeq: 3,
        done: false,
        chunks: [{ sessionId: "s1", seq: 2, stream: "stdout", data: "x", ts: Date.now() }],
      }),
      start: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      respond: vi.fn(),
      cancel: vi.fn(),
      onOutput: vi.fn().mockReturnValue(() => {}),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
    };
    const r = (await handleRpc(
      mockCtx({ terminalManager: terminalManager as unknown as RpcHandlerContext["terminalManager"] }),
      "memeloop.terminal.follow",
      { sessionId: "s1", fromSeq: 2 },
    )) as { nextSeq?: number };
    expect(r.nextSeq).toBe(3);
    expect(terminalManager.follow).toHaveBeenCalledWith("s1", {
      fromSeq: 2,
      untilExit: false,
      maxWaitMs: 30000,
    });
  });

  it("memeloop.agent.resolveApproval returns ok", async () => {
    const r = (await handleRpc(
      mockCtx(),
      "memeloop.agent.resolveApproval",
      { approvalId: "a1", decision: "allow" },
    )) as { ok?: boolean };
    expect(r.ok).toBe(true);
  });
});
