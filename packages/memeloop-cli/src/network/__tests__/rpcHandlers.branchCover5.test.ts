import { describe, expect, it, vi } from "vitest";

import type { RpcHandlerContext } from "../rpcHandlers.js";
import { handleRpc } from "../rpcHandlers.js";

function makeCtx(over: Partial<RpcHandlerContext> = {}): RpcHandlerContext {
  return {
    runtime: {
      createAgent: vi.fn(),
      sendMessage: vi.fn(),
      cancelAgent: vi.fn(),
      subscribeToUpdates: vi.fn().mockReturnValue(() => {}),
    } as any,
    storage: {
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
    } as any,
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

describe("rpcHandlers branch cover 5", () => {
  it("mcp.listServers when context.mcpServers is undefined returns empty array", async () => {
    const ctx = makeCtx({ mcpServers: undefined });
    const r = (await handleRpc(ctx, "memeloop.mcp.listServers", {})) as any;
    expect(r.servers).toEqual([]);
  });

  it("unknown method should throw Method not found", async () => {
    const ctx = makeCtx();
    await expect(handleRpc(ctx, "memeloop.unknown.method", {})).rejects.toThrow(/Method not found/);
  });
});

