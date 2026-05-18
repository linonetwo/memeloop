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
      createAgent: vi.fn(),
      sendMessage: vi.fn(),
      cancelAgent: vi.fn(),
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

describe("rpcHandlers branch cover 7", () => {
  it("terminal.execute: timeoutMs invalid type defaults to 60_000", async () => {
    const terminalManager = {
      start: vi.fn().mockResolvedValue({ sessionId: "s1" }),
      follow: vi.fn().mockResolvedValue({
        sessionId: "s1",
        status: "exited",
        exitCode: 0,
        nextSeq: 2,
        done: true,
        chunks: [],
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue({ sessionId: "s1", status: "running" }),
      list: vi.fn(),
      respond: vi.fn(),
      onOutput: vi.fn().mockReturnValue(() => {}),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
    } as any;

    const ctx = makeCtx({ terminalManager });
    await handleRpc(ctx, "memeloop.terminal.execute", {
      command: "echo hi",
      waitMode: "until-timeout",
      timeoutMs: true as any,
      // omit maxWaitMs to force `maxWaitMsRaw = timeoutMs`
      stream: false,
    });

    expect(terminalManager.follow).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ maxWaitMs: 60_000 }),
    );
  });

  it("terminal.execute: maxWaitMs non-numeric string falls back to timeoutMs", async () => {
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

    const ctx = makeCtx({ terminalManager });
    await handleRpc(ctx, "memeloop.terminal.execute", {
      command: "echo hi",
      waitMode: "until-timeout",
      timeoutMs: 1234,
      maxWaitMs: "not-a-number" as any,
      stream: false,
    });

    expect(terminalManager.follow).toHaveBeenCalledWith(
      "s2",
      expect.objectContaining({ maxWaitMs: 1234 }),
    );
  });

  it("knowledge/wikis: wikiManager present drives default wiki payload", async () => {
    const ctx = makeCtx({ wikiManager: {} as any });

    const list = (await handleRpc(ctx, "memeloop.wiki.listWikis", {})) as any;
    expect(list.wikis).toEqual([{ wikiId: "default", title: "default" }]);

    const info = (await handleRpc(ctx, "memeloop.node.getInfo", {})) as any;
    expect(info.capabilities.hasWiki).toBe(true);
    expect(info.capabilities.wikis).toEqual([{ wikiId: "default", title: "default" }]);
  });
});

