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

describe("rpcHandlers branch cover 6", () => {
  it("terminal.execute maxWaitMs fallback branch when maxWaitMs is non-number/non-string", async () => {
    const terminalManager = {
      start: vi.fn().mockResolvedValue({ sessionId: "s4" }),
      follow: vi.fn().mockResolvedValue({
        sessionId: "s4",
        status: "exited",
        exitCode: 0,
        nextSeq: 2,
        done: true,
        chunks: [],
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue({ sessionId: "s4", status: "running" }),
      list: vi.fn(),
      respond: vi.fn(),
      onOutput: vi.fn().mockReturnValue(() => {}),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
    } as any;

    const ctx = makeCtx({ terminalManager, storage: makeStorage(), notify: undefined });
    await handleRpc(ctx, "memeloop.terminal.execute", {
      command: "echo hi",
      waitMode: "until-timeout",
      timeoutMs: 1000,
      // Force `maxWaitMsRaw` into last fallback branch.
      maxWaitMs: true as any,
      stream: false,
    });

    expect(terminalManager.follow).toHaveBeenCalledWith(
      "s4",
      expect.objectContaining({ maxWaitMs: 1000 }),
    );
  });

  it("memeloop.wiki.listWikis returns empty when wikiManager is undefined", async () => {
    const ctx = makeCtx({ wikiManager: undefined });
    const r = (await handleRpc(ctx, "memeloop.wiki.listWikis", {})) as any;
    expect(r.wikis).toEqual([]);
  });

  it("memeloop.node.getInfo hasWiki=false and wikis empty when wikiManager is undefined", async () => {
    const ctx = makeCtx({ wikiManager: undefined });
    const r = (await handleRpc(ctx, "memeloop.node.getInfo", {})) as any;
    expect(r.capabilities.hasWiki).toBe(false);
    expect(r.capabilities.wikis).toEqual([]);
  });
});

