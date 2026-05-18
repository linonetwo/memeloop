import { describe, expect, it, vi } from "vitest";

import type { RpcHandlerContext } from "../rpcHandlers.js";
import { handleRpc } from "../rpcHandlers.js";

const callMcpToolOnServerMock = vi.fn();
vi.mock("../../mcp/localMcpClient.js", () => ({
  listAllMcpTools: vi.fn(),
  callMcpToolOnServer: (...args: any[]) => callMcpToolOnServerMock(...args),
}));

function makeBaseCtx(over: Partial<RpcHandlerContext> = {}): RpcHandlerContext {
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

describe("rpcHandlers branch cover 3", () => {
  it("terminal.list/respond/cancel cover branches", async () => {
    const terminalManager = {
      start: vi.fn(),
      follow: vi.fn(),
      list: vi.fn().mockResolvedValue([{ sessionId: "s1" }]),
      respond: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue(undefined),
      onOutput: vi.fn().mockReturnValue(() => {}),
      onStatusUpdate: vi.fn().mockReturnValue(() => {}),
      onInteractionPrompt: vi.fn().mockReturnValue(() => {}),
    } as any;

    const ctx = makeBaseCtx({ terminalManager: terminalManager as any });

    await expect(handleRpc(ctx, "memeloop.terminal.list", {})).resolves.toEqual({ sessions: [{ sessionId: "s1" }] });
    await expect(handleRpc(ctx, "memeloop.terminal.respond", { sessionId: "s1", input: "hi" })).resolves.toEqual({ ok: true });
    await expect(handleRpc(ctx, "memeloop.terminal.cancel", { sessionId: "s1" })).resolves.toMatchObject({
      ok: true,
      sessionId: "s1",
      finalStatus: "killed",
    });
  });

  it("mcp.callTool covers validation + success + catch", async () => {
    const ctx = makeBaseCtx({ mcpServers: [{ name: "s1", command: "cmd" }] });

    await expect(
      handleRpc(ctx, "memeloop.mcp.callTool", { serverName: "", toolName: "t1", arguments: {} }),
    ).resolves.toEqual({ error: "serverName and toolName are required" });

    callMcpToolOnServerMock.mockResolvedValueOnce({ ok: true });
    await expect(
      handleRpc(ctx, "memeloop.mcp.callTool", { serverName: "s1", toolName: "t1", arguments: { a: 1 } }),
    ).resolves.toEqual({ result: { ok: true } });

    callMcpToolOnServerMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      handleRpc(ctx, "memeloop.mcp.callTool", { serverName: "s1", toolName: "t1", arguments: {} }),
    ).resolves.toMatchObject({ error: "MCP callTool failed: boom" });
  });

  it("knowledge.write tags array/empty branches", async () => {
    const setTiddler = vi.fn().mockResolvedValue(undefined);
    const wikiManager = { setTiddler } as any;
    const ctx = makeBaseCtx({ wikiManager });

    await handleRpc(ctx, "memeloop.knowledge.write", { wikiId: "w", title: "t1", text: "body", tags: ["a", "b"] });
    expect(setTiddler).toHaveBeenCalledWith(
      "w",
      expect.objectContaining({
        title: "t1",
        text: "body",
        type: "text/vnd.tiddlywiki",
        tags: ["a", "b"],
      }),
    );

    setTiddler.mockClear();
    await handleRpc(ctx, "memeloop.knowledge.write", { wikiId: "w", title: "t2", text: "body", tags: [] });
    // tags is empty => should not include tags property
    expect(setTiddler).toHaveBeenCalledWith(
      "w",
      expect.objectContaining({
        title: "t2",
        text: "body",
      }),
    );
    expect((setTiddler.mock.calls[0][1] as any).tags).toBeUndefined();
  });

  it("storage.getAttachmentBlob uses defaults when attachment ref missing", async () => {
    const storage = makeBaseCtx().storage;
    storage.readAttachmentData = vi.fn().mockResolvedValue(new Uint8Array([1, 2]));
    storage.getAttachment = vi.fn().mockResolvedValue(undefined);
    storage.saveAttachment = vi.fn();

    const ctx = makeBaseCtx({ storage: storage as any });
    const r = (await handleRpc(ctx, "memeloop.storage.getAttachmentBlob", { contentHash: "h1" })) as any;
    expect(r.found).toBe(true);
    expect(r.filename).toBe("attachment");
    expect(r.mimeType).toBe("application/octet-stream");
    expect(r.size).toBe(2);
  });
});

