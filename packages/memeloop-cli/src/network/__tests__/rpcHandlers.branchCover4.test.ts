import { describe, expect, it, vi } from "vitest";

import type { RpcHandlerContext } from "../rpcHandlers.js";
import { handleRpc } from "../rpcHandlers.js";

function makeStorage() {
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
    getAttachment: vi.fn(),
    saveAttachment: vi.fn(),
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
    toolRegistry: undefined,
    nodeId: "node-self",
    mcpServers: undefined,
    imChannels: undefined,
    agentDefinitions: undefined,
    fileBaseDir: undefined,
    verifyPinCode: undefined,
    ...over,
  };
}

describe("rpcHandlers branch cover 4", () => {
  it("terminal.execute until-timeout timedOut=false should not cancel and should return chunks when stream=false", async () => {
    const terminalManager = {
      start: vi.fn().mockResolvedValue({ sessionId: "s1" }),
      follow: vi.fn().mockResolvedValue({
        sessionId: "s1",
        status: "exited",
        exitCode: 0,
        nextSeq: 2,
        done: true,
        chunks: [
          { sessionId: "s1", seq: 1, stream: "stdout", data: "hello", ts: 1 },
          { sessionId: "s1", seq: 2, stream: "stderr", data: "err", ts: 2 },
        ],
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue({ sessionId: "s1", status: "running" }),
      list: vi.fn(),
      respond: vi.fn(),
      onOutput: vi.fn().mockReturnValue(() => {}),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
    } as any;

    const ctx = makeCtx({
      terminalManager,
      notify: undefined,
      storage: makeStorage(),
    });

    const r = (await handleRpc(ctx, "memeloop.terminal.execute", {
      command: "echo hi",
      waitMode: "until-timeout",
      timeoutMs: 1000,
      maxWaitMs: 100,
      stream: false,
    })) as any;

    expect(terminalManager.cancel).not.toHaveBeenCalled();
    expect(r.timedOut).toBe(false);
    // stream=false branch: chunks should be emptied by handler
    expect(r.chunks).toEqual([]);
    // stdout/stderr are still concatenated for output.
    expect(r.stdout).toBe("hello");
    expect(r.stderr).toBe("err");
  });

  it("terminal.execute uses Math.min for idleTimeoutMs when timeoutMs > 15_000", async () => {
    const terminalManager = {
      start: vi.fn().mockResolvedValue({ sessionId: "s2" }),
      follow: vi.fn().mockResolvedValue({
        sessionId: "s2",
        status: "exited",
        exitCode: 0,
        nextSeq: 2,
        done: true,
        chunks: [],
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue({ sessionId: "s2", status: "running" }),
      list: vi.fn(),
      respond: vi.fn(),
      onOutput: vi.fn().mockReturnValue(() => {}),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
    } as any;

    const storage = makeStorage();
    const ctx = makeCtx({ terminalManager, storage, notify: undefined });

    await handleRpc(ctx, "memeloop.terminal.execute", {
      command: "echo hi",
      timeoutMs: 20_000,
      waitMode: "until-exit",
      stream: false,
    });

    expect(terminalManager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        idleTimeoutMs: 15_000,
      }),
    );
  });

  it("terminal.execute unsubscribes early when terminalManager.get returns non-running status", async () => {
    const unsubOutput = vi.fn();
    const unsubStatus = vi.fn();
    const unsubPrompt = vi.fn();
    const notify = vi.fn();

    const terminalManager = {
      start: vi.fn().mockResolvedValue({ sessionId: "s3" }),
      follow: vi.fn().mockResolvedValue({
        sessionId: "s3",
        status: "exited",
        exitCode: 0,
        nextSeq: 2,
        done: true,
        chunks: [],
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue({ sessionId: "s3", status: "exited" }),
      list: vi.fn(),
      respond: vi.fn(),
      onOutput: vi.fn().mockReturnValue(unsubOutput),
      onStatusUpdate: vi.fn().mockReturnValue(unsubStatus),
      onInteractionPrompt: vi.fn().mockReturnValue(unsubPrompt),
    } as any;

    const ctx = makeCtx({
      terminalManager,
      notify,
      storage: makeStorage(),
    });

    await handleRpc(ctx, "memeloop.terminal.execute", {
      command: "echo hi",
      waitMode: "until-timeout",
      timeoutMs: 1000,
      maxWaitMs: 50,
      stream: true,
    });

    expect(unsubOutput).toHaveBeenCalled();
    expect(unsubPrompt).toHaveBeenCalled();
    expect(unsubStatus).toHaveBeenCalled();
  });

  it("sync.exchangeVersionVector localVersion invalid type should default to {}", async () => {
    const storage = makeStorage();
    storage.listConversations = vi.fn().mockResolvedValue([
      {
        conversationId: "c1",
        originNodeId: "n1",
        lastMessageTimestamp: 100,
      },
      {
        conversationId: "c2",
        originNodeId: "n2",
        lastMessageTimestamp: 50,
      },
    ]);

    const ctx = makeCtx({ storage, nodeId: "local" });

    const r = (await handleRpc(ctx, "memeloop.sync.exchangeVersionVector", { localVersion: ["bad"] as any })) as any;
    expect(r.missingForRemote).toHaveLength(2);
  });

  it("sync.pullMissingMetadata sinceVersion invalid type should default to {}", async () => {
    const storage = makeStorage();
    storage.listConversations = vi.fn().mockResolvedValue([
      { conversationId: "c1", originNodeId: "n1", lastMessageTimestamp: 100 },
      { conversationId: "c2", originNodeId: "n2", lastMessageTimestamp: 50 },
    ]);
    const ctx = makeCtx({ storage, nodeId: "local" });

    const r = (await handleRpc(ctx, "memeloop.sync.pullMissingMetadata", { sinceVersion: "bad" as any })) as any;
    expect(r.metas).toHaveLength(2);
  });

  it("sync.pullMissingMessages with empty conversationId should return empty messages", async () => {
    const ctx = makeCtx();
    const r = (await handleRpc(ctx, "memeloop.sync.pullMissingMessages", {
      conversationId: "  ",
      knownMessageIds: ["m1"],
    })) as any;
    expect(r.messages).toEqual([]);
  });

  it("chat.pullSubAgentLog with empty conversationId should return empty messages and conversationId", async () => {
    const ctx = makeCtx({ nodeId: "node-self" });
    const r = (await handleRpc(ctx, "memeloop.chat.pullSubAgentLog", {
      conversationId: "  ",
      knownMessageIds: ["m1"],
    })) as any;
    expect(r.nodeId).toBe("node-self");
    expect(r.conversationId).toBe("");
    expect(r.messages).toEqual([]);
  });

  it("chat.pullTerminalSession none branch when storage empty and terminalManager missing", async () => {
    const storage = makeStorage();
    storage.getMessages = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ storage, terminalManager: undefined });
    const r = (await handleRpc(ctx, "memeloop.chat.pullTerminalSession", { sessionId: "sid-1" })) as any;
    expect(r.source).toBe("none");
    expect(r.chunks).toEqual([]);
    expect(r.messages).toEqual([]);
  });

  it("knowledge.write with tags omitted should not set tags field", async () => {
    const setTiddler = vi.fn().mockResolvedValue(undefined);
    const wikiManager = { setTiddler } as any;
    const ctx = makeCtx({ wikiManager });
    await handleRpc(ctx, "memeloop.knowledge.write", { wikiId: "w", title: "t1", text: "body" });
    expect(setTiddler).toHaveBeenCalled();
    const payload = setTiddler.mock.calls[0][1] as any;
    expect(payload.title).toBe("t1");
    expect(payload.text).toBe("body");
    expect(payload.tags).toBeUndefined();
  });

  it("knowledge.list should call listTiddlers branch when query omitted", async () => {
    const listTiddlers = vi.fn().mockResolvedValue([{ title: "l1" }]);
    const search = vi.fn().mockResolvedValue([{ title: "s1" }]);
    const wikiManager = { listTiddlers, search } as any;
    const ctx = makeCtx({ wikiManager });

    const r = (await handleRpc(ctx, "memeloop.knowledge.list", { wikiId: "w" })) as any;
    expect(r.tiddlers).toEqual([{ title: "l1" }]);
    expect(search).not.toHaveBeenCalled();
    expect(listTiddlers).toHaveBeenCalledWith("w");
  });
});

