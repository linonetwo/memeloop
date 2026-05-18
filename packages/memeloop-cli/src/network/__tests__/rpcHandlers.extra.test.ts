import { describe, expect, it, vi } from "vitest";

const resolveQuestionAnswerMock = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock("memeloop", async () => {
  const actual = await vi.importActual<any>("memeloop");
  return {
    ...actual,
    resolveQuestionAnswer: resolveQuestionAnswerMock,
    resolveApproval: vi.fn(),
  };
});

import { handleRpc, type RpcHandlerContext } from "../rpcHandlers.js";

function makeStorage(over: Partial<RpcHandlerContext["storage"]> = {}): RpcHandlerContext["storage"] {
  return {
    listConversations: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    upsertConversationMetadata: vi.fn().mockResolvedValue(undefined),
    insertMessagesIfAbsent: vi.fn().mockResolvedValue(undefined),
    getAgentDefinition: vi.fn(),
    saveAgentInstance: vi.fn(),
    getConversationMeta: vi.fn(),
    readAttachmentData: vi.fn(),
    getAttachment: vi.fn().mockResolvedValue(undefined),
    saveAttachment: vi.fn(),
    ...over,
  } as any;
}

function makeCtx(over: Partial<RpcHandlerContext> = {}): RpcHandlerContext {
  return {
    runtime: {
      createAgent: vi.fn().mockResolvedValue({ conversationId: "c-new" }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelAgent: vi.fn().mockResolvedValue(undefined),
      subscribeToUpdates: vi.fn().mockReturnValue(() => {}),
    } as any,
    storage: makeStorage(),
    terminalManager: undefined,
    wikiManager: undefined,
    toolRegistry: { listTools: vi.fn().mockReturnValue(["t1"]) },
    nodeId: "node-self",
    mcpServers: [{ name: "m1", command: "x", args: [] }],
    imChannels: [{ channelId: "ch1", platform: "telegram", defaultDefinitionId: "d", botToken: "bt", webhookSecret: "ws" }],
    agentDefinitions: [
      { id: "agent-1", name: "A", description: "", systemPrompt: "", tools: [], version: "1" } as any,
    ],
    fileBaseDir: undefined,
    verifyPinCode: undefined,
    ...over,
  };
}

describe("handleRpc extra branches", () => {
  it("memeloop.auth.confirmPin returns pin_verifier_not_configured when callback missing", async () => {
    const ctx = makeCtx({ verifyPinCode: undefined });
    const r = (await handleRpc(ctx, "memeloop.auth.confirmPin", { confirmCode: "  123456 " })) as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("pin_verifier_not_configured");
  });

  it("memeloop.im.listChannels / memeloop.im.getChannel mapping", async () => {
    const ctx = makeCtx({
      imChannels: [
        { channelId: "ch1", platform: "telegram", defaultDefinitionId: "d", botToken: "bt", webhookSecret: "ws", discordPublicKey: undefined } as any,
      ],
    });
    const list = (await handleRpc(ctx, "memeloop.im.listChannels", {})) as any;
    expect(list.channels[0]).toMatchObject({ channelId: "ch1", hasBotToken: true, hasWebhookSecret: true });

    const get = (await handleRpc(ctx, "memeloop.im.getChannel", { channelId: "ch1" })) as any;
    expect(get.channel.channelId).toBe("ch1");

    const missing = (await handleRpc(ctx, "memeloop.im.getChannel", { channelId: "no" })) as any;
    expect(missing.channel).toBeNull();
  });

  it("memeloop.agent.create/send/cancel/list/resolveQuestion/resolveApproval", async () => {
    const listConversations = vi.fn().mockResolvedValue([{ conversationId: "c1" }]);
    const ctx = makeCtx({
      storage: makeStorage({ listConversations }),
    });

    const created = (await handleRpc(ctx, "memeloop.agent.create", { definitionId: "d", initialMessage: "hi" })) as any;
    expect(created.conversationId).toBe("c-new");

    await handleRpc(ctx, "memeloop.agent.send", { conversationId: "c1", message: "m" });
    await handleRpc(ctx, "memeloop.agent.cancel", { conversationId: "c1" });

    const list = (await handleRpc(ctx, "memeloop.agent.list", {})) as any;
    expect(list.conversations).toEqual([{ conversationId: "c1" }]);

    const okQ = (await handleRpc(ctx, "memeloop.agent.resolveQuestion", { questionId: "q1", answer: "a1" })) as any;
    expect(okQ.ok).toBe(true);

    const badQ = (await handleRpc(ctx, "memeloop.agent.resolveQuestion", { questionId: "q1", answer: "" })) as any;
    expect(badQ.ok).toBe(false);

    const okA = (await handleRpc(ctx, "memeloop.agent.resolveApproval", { approvalId: "a1", decision: "allow" })) as any;
    expect(okA.ok).toBe(true);
  });

  it("knowledge.search/list/get/write and memeloop.wiki.listWikis", async () => {
    const wikiManager = {
      search: vi.fn().mockResolvedValue([{ title: "s1", type: "t", tags: [], modified: "m", text: "" }]),
      listTiddlers: vi.fn().mockResolvedValue([{ title: "l1", type: "t", tags: [], modified: "m", text: "" }]),
      getTiddler: vi.fn().mockResolvedValue({ title: "x", text: "y" }),
      setTiddler: vi.fn().mockResolvedValue(undefined),
    } as any;

    const ctx = makeCtx({ wikiManager });

    const q = (await handleRpc(ctx, "memeloop.knowledge.query", { wikiId: "w", query: "hello" })) as any;
    expect(q.tiddlers[0].title).toBe("s1");

    const list = (await handleRpc(ctx, "memeloop.knowledge.list", { wikiId: "w" })) as any;
    expect(list.tiddlers[0].title).toBe("l1");

    const get = (await handleRpc(ctx, "memeloop.knowledge.get", { wikiId: "w", title: "t1" })) as any;
    expect(get.tiddler.title).toBe("x");

    await handleRpc(ctx, "memeloop.knowledge.write", { wikiId: "w", title: "t2", text: "body", tags: "a,b c" });
    // tags string is split by whitespace, not commas
    expect(wikiManager.setTiddler).toHaveBeenCalledWith(
      "w",
      expect.objectContaining({ title: "t2", text: "body", tags: ["a,b", "c"] }),
    );

    const wikis = (await handleRpc(ctx, "memeloop.wiki.listWikis", {})) as any;
    expect(wikis.wikis).toEqual([{ wikiId: "default", title: "default" }]);
  });

  it("memeloop.sync exchange/pullMissingMetadata/pullMissingMessages", async () => {
    const listConversations = vi.fn().mockResolvedValue([
      { conversationId: "c1", originNodeId: "n1", lastMessageTimestamp: 100, lastMessagePreview: "", title: "", messageCount: 0, definitionId: "d", isUserInitiated: true },
      { conversationId: "c2", originNodeId: "n2", lastMessageTimestamp: 50, lastMessagePreview: "", title: "", messageCount: 0, definitionId: "d", isUserInitiated: true },
    ]);
    const getMessages = vi.fn().mockResolvedValue([
      { messageId: "m1", conversationId: "c1", originNodeId: "local", timestamp: 1, lamportClock: 1, role: "user", content: "x" },
    ]);
    const ctx = makeCtx({
      storage: makeStorage({ listConversations, getMessages }),
      nodeId: "local",
    });

    const exchange = (await handleRpc(ctx, "memeloop.sync.exchangeVersionVector", { localVersion: { n1: 0 } })) as any;
    expect(exchange.missingForRemote).toBeInstanceOf(Array);

    const pullMeta = (await handleRpc(ctx, "memeloop.sync.pullMissingMetadata", { sinceVersion: { n1: 0, n2: 999 } })) as any;
    expect(pullMeta.metas).toEqual(expect.any(Array));

    const pullMsgs = (await handleRpc(ctx, "memeloop.sync.pullMissingMessages", { conversationId: "c1", knownMessageIds: ["m1"] })) as any;
    expect(pullMsgs.messages).toEqual([]);
  });

  it("storage.getAttachmentBlob validation branches", async () => {
    const ctx = makeCtx({
      storage: makeStorage({
        readAttachmentData: undefined as any,
      }),
    });
    const missingHash = (await handleRpc(ctx, "memeloop.storage.getAttachmentBlob", {})) as any;
    expect(missingHash.error).toBe("contentHash is required");

    const noReader = (await handleRpc(ctx, "memeloop.storage.getAttachmentBlob", { contentHash: "h1" })) as any;
    expect(noReader.error).toContain("readAttachmentData not supported");
  });

  it("memeloop.chat.pullTerminalSession empty sessionId branch", async () => {
    const ctx = makeCtx();
    const r = (await handleRpc(ctx, "memeloop.chat.pullTerminalSession", { sessionId: "  " })) as any;
    expect(r.source).toBe("none");
    expect(r.sessionId).toBe("");
    expect(r.messages).toEqual([]);
  });
});

