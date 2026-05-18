import { MEMELOOP_STRUCTURED_TOOL_KEY } from "memeloop";
import { describe, expect, it, vi } from "vitest";

import type { TerminalOutputChunk } from "../../terminal/types.js";
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
    const r = (await handleRpc(mockCtx(), "memeloop.auth.handshake", {})) as {
      ok?: boolean;
      nodeId?: string;
    };
    expect(r.ok).toBe(true);
    expect(r.nodeId).toBe("node-self");
  });

  it("memeloop.auth.hello returns received node info", async () => {
    const r = (await handleRpc(mockCtx(), "memeloop.auth.hello", {
      nodeId: "peer-1",
      capabilities: { tools: ["terminal.execute"] },
    })) as { ok?: boolean; nodeId?: string; receivedAt?: number };
    expect(r.ok).toBe(true);
    expect(r.nodeId).toBe("peer-1");
    expect(typeof r.receivedAt).toBe("number");
  });

  it("memeloop.auth.confirmPin validates via verifyPinCode callback", async () => {
    const verifyPinCode = vi.fn().mockResolvedValue(true);
    const r = (await handleRpc(mockCtx({ verifyPinCode }), "memeloop.auth.confirmPin", {
      confirmCode: "123456",
    })) as { ok?: boolean };
    expect(r.ok).toBe(true);
    expect(verifyPinCode).toHaveBeenCalledWith("123456");
  });

  it("memeloop.auth.confirmPin rate-limits after 3 mismatches for the same WS state", async () => {
    const verifyPinCode = vi.fn().mockResolvedValue(false);
    const pinConfirmState = { consecutiveFails: 0, lockedUntil: 0 };
    const ctx = mockCtx({ verifyPinCode, pinConfirmState });
    for (let i = 0; i < 3; i++) {
      const r = (await handleRpc(ctx, "memeloop.auth.confirmPin", { confirmCode: "111111" })) as {
        ok?: boolean;
        reason?: string;
      };
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("pin_mismatch");
    }
    const limited = (await handleRpc(ctx, "memeloop.auth.confirmPin", {
      confirmCode: "111111",
    })) as { ok?: boolean; reason?: string; retryAfterMs?: number };
    expect(limited.ok).toBe(false);
    expect(limited.reason).toBe("pin_rate_limited");
    expect(typeof limited.retryAfterMs).toBe("number");
    expect(verifyPinCode).toHaveBeenCalledTimes(3);
  });

  it("memeloop.auth.confirmPin success resets failure counter", async () => {
    const verifyPinCode = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const pinConfirmState = { consecutiveFails: 0, lockedUntil: 0 };
    const ctx = mockCtx({ verifyPinCode, pinConfirmState });
    await handleRpc(ctx, "memeloop.auth.confirmPin", { confirmCode: "111111" });
    const ok = (await handleRpc(ctx, "memeloop.auth.confirmPin", { confirmCode: "222222" })) as {
      ok?: boolean;
    };
    expect(ok.ok).toBe(true);
    expect(pinConfirmState.consecutiveFails).toBe(0);
  });

  it("memeloop.auth.exchangeJwt checks userId equality", async () => {
    const mkJwt = (userId: string) => {
      const h = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const p = Buffer.from(JSON.stringify({ userId })).toString("base64url");
      return `${h}.${p}.`;
    };
    const r1 = (await handleRpc(mockCtx(), "memeloop.auth.exchangeJwt", {
      localJwt: mkJwt("u-1"),
      remoteJwt: mkJwt("u-1"),
    })) as { ok?: boolean; matchedUserId?: string };
    expect(r1.ok).toBe(true);
    expect(r1.matchedUserId).toBe("u-1");

    const r2 = (await handleRpc(mockCtx(), "memeloop.auth.exchangeJwt", {
      localJwt: mkJwt("u-1"),
      remoteJwt: mkJwt("u-2"),
    })) as { ok?: boolean };
    expect(r2.ok).toBe(false);
  });

  it("memeloop.agent.getDefinitions returns YAML definitions", async () => {
    const r = (await handleRpc(mockCtx(), "memeloop.agent.getDefinitions", {})) as {
      definitions?: Array<{ id?: string }>;
    };
    expect(r.definitions?.[0]?.id).toBe("agent-1");
  });

  it("memeloop.sync.pullMissingMessages filters known ids", async () => {
    const r = (await handleRpc(mockCtx(), "memeloop.sync.pullMissingMessages", {
      conversationId: "c1",
      knownMessageIds: ["m-new"],
    })) as { messages?: unknown[] };
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
      mockCtx({
        terminalManager: terminalManager as unknown as RpcHandlerContext["terminalManager"],
      }),
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

  it("memeloop.terminal.start forwards explicit args/env and preserves structured summary", async () => {
    const appendMessage = vi.fn().mockResolvedValue(undefined);
    const upsertConversationMetadata = vi.fn().mockResolvedValue(undefined);
    const terminalManager = {
      follow: vi.fn(),
      start: vi.fn().mockResolvedValue({ sessionId: "s-start" }),
      list: vi.fn(),
      get: vi.fn().mockReturnValue({ sessionId: "s-start", status: "running" }),
      respond: vi.fn(),
      cancel: vi.fn(),
      onOutput: vi.fn().mockReturnValue(() => {}),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
      onSessionComplete: vi.fn().mockReturnValue(() => {}),
      signal: vi.fn(),
      getOutputText: vi.fn(),
      getChunksSince: vi.fn(),
    };
    const base = mockCtx();
    const ctx = {
      ...base,
      storage: {
        ...base.storage,
        appendMessage,
        upsertConversationMetadata,
      } as RpcHandlerContext["storage"],
      terminalManager: terminalManager as unknown as RpcHandlerContext["terminalManager"],
    };

    const r = (await handleRpc(ctx, "memeloop.terminal.start", {
      command: "C:/Program Files/node.exe",
      args: ["-e", "console.log(process.env.TEST_FLAG)"],
      env: { TEST_FLAG: "1" },
      mode: "await",
    })) as any;

    expect(terminalManager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "C:/Program Files/node.exe",
        args: ["-e", "console.log(process.env.TEST_FLAG)"],
        env: { TEST_FLAG: "1" },
      }),
    );
    expect(r.sessionId).toBe("s-start");
    expect(r[MEMELOOP_STRUCTURED_TOOL_KEY]?.summary).toContain(
      "[terminal.start await] C:/Program Files/node.exe -e console.log(process.env.TEST_FLAG)",
    );
  });

  it("memeloop.agent.resolveApproval returns ok", async () => {
    const r = (await handleRpc(mockCtx(), "memeloop.agent.resolveApproval", {
      approvalId: "a1",
      decision: "allow",
    })) as { ok?: boolean };
    expect(r.ok).toBe(true);
  });

  it("memeloop.chat.pullSubAgentLog returns filtered messages", async () => {
    const base = mockCtx();
    const getMessages = vi.fn().mockResolvedValue([
      {
        messageId: "a",
        conversationId: "spawn:x",
        originNodeId: "local",
        timestamp: 1,
        lamportClock: 1,
        role: "assistant" as const,
        content: "hi",
      },
      {
        messageId: "b",
        conversationId: "spawn:x",
        originNodeId: "local",
        timestamp: 2,
        lamportClock: 2,
        role: "user" as const,
        content: "u",
      },
    ]);
    const ctx = {
      ...base,
      storage: { ...base.storage, getMessages } as RpcHandlerContext["storage"],
    };
    const r = (await handleRpc(ctx, "memeloop.chat.pullSubAgentLog", {
      conversationId: "spawn:x",
      knownMessageIds: ["a"],
    })) as { messages?: Array<{ messageId: string }>; nodeId?: string };
    expect(r.nodeId).toBe("node-self");
    expect(r.messages?.map((m) => m.messageId)).toEqual(["b"]);
  });

  it("memeloop.chat.pullTerminalSession prefers storage conversation terminal:<sessionId>", async () => {
    const base = mockCtx();
    const storedMsg = {
      messageId: "log1",
      conversationId: "terminal:sid-1",
      originNodeId: "local",
      timestamp: 1,
      lamportClock: 1,
      role: "tool" as const,
      content: "out",
    };
    const getMessages = vi
      .fn()
      .mockImplementation(async (cid: string) => (cid === "terminal:sid-1" ? [storedMsg] : []));
    const ctx = {
      ...base,
      storage: { ...base.storage, getMessages } as RpcHandlerContext["storage"],
    };
    const r = (await handleRpc(ctx, "memeloop.chat.pullTerminalSession", {
      sessionId: "sid-1",
    })) as {
      source?: string;
      messages?: unknown[];
    };
    expect(r.source).toBe("storage");
    expect(r.messages).toHaveLength(1);
  });

  it("memeloop.chat.pullTerminalSession falls back to in-memory terminal chunks", async () => {
    const base = mockCtx();
    const getMessages = vi.fn().mockResolvedValue([]);
    const terminalManager = {
      get: vi.fn().mockReturnValue({ sessionId: "s-mem", status: "running" }),
      getChunksSince: vi
        .fn()
        .mockReturnValue([{ sessionId: "s-mem", seq: 1, stream: "stdout", data: "ok", ts: 1 }]),
      follow: vi.fn(),
      start: vi.fn(),
      list: vi.fn(),
      respond: vi.fn(),
      cancel: vi.fn(),
      onOutput: vi.fn().mockReturnValue(() => {}),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
    };
    const ctx = {
      ...base,
      storage: { ...base.storage, getMessages } as RpcHandlerContext["storage"],
      terminalManager: terminalManager as unknown as RpcHandlerContext["terminalManager"],
    };
    const r = (await handleRpc(ctx, "memeloop.chat.pullTerminalSession", {
      sessionId: "s-mem",
      fromSeq: 1,
    })) as {
      source?: string;
      chunks?: Array<{ data?: string }>;
    };
    expect(r.source).toBe("memory");
    expect(r.chunks?.[0]?.data).toBe("ok");
    expect(terminalManager.getChunksSince).toHaveBeenCalledWith("s-mem", 1);
  });

  it("memeloop.terminal.execute upserts terminal:* metadata and persists stdout chunks to storage", async () => {
    const appendMessage = vi.fn().mockResolvedValue(undefined);
    const upsertConversationMetadata = vi.fn().mockResolvedValue(undefined);
    let outputListener: ((chunk: TerminalOutputChunk) => void) | undefined;
    const sessionId = "sess-persist";
    const terminalManager = {
      start: vi.fn().mockResolvedValue({ sessionId }),
      follow: vi.fn().mockImplementation(async () => {
        outputListener?.({
          sessionId,
          seq: 1,
          stream: "stdout",
          data: "hi\n",
          ts: 100,
        });
        return {
          sessionId,
          status: "exited",
          exitCode: 0,
          nextSeq: 2,
          done: true,
          chunks: [],
        };
      }),
      onOutput: vi.fn((listener: (chunk: TerminalOutputChunk) => void) => {
        outputListener = listener;
        return () => {};
      }),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
      get: vi.fn().mockReturnValue({ sessionId, status: "running" }),
      list: vi.fn(),
      respond: vi.fn(),
      cancel: vi.fn(),
    };
    const base = mockCtx();
    const ctx = {
      ...base,
      storage: {
        ...base.storage,
        appendMessage,
        upsertConversationMetadata,
      } as RpcHandlerContext["storage"],
      terminalManager: terminalManager as unknown as RpcHandlerContext["terminalManager"],
    };
    await handleRpc(ctx, "memeloop.terminal.execute", { command: "echo hi", timeoutMs: 5000 });
    expect(upsertConversationMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: `terminal:${sessionId}`,
        isUserInitiated: false,
        definitionId: "memeloop:terminal-session",
      }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: `terminal:${sessionId}`,
        content: "[stdout] hi\n",
        role: "tool",
      }),
    );
  });
});
