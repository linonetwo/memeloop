import { describe, expect, it, vi } from "vitest";

import type { RpcHandlerContext } from "../rpcHandlers.js";
import { handleRpc } from "../rpcHandlers.js";

const runFileReadRpcMock = vi.fn();
const runFileWriteRpcMock = vi.fn();
const runFileListRpcMock = vi.fn();
const runFileSearchRpcMock = vi.fn();
const runFileTailRpcMock = vi.fn();
vi.mock("../../tools/fileSystem.js", () => ({
  runFileReadRpc: (...args: any[]) => runFileReadRpcMock(...args),
  runFileWriteRpc: (...args: any[]) => runFileWriteRpcMock(...args),
  runFileListRpc: (...args: any[]) => runFileListRpcMock(...args),
  runFileSearchRpc: (...args: any[]) => runFileSearchRpcMock(...args),
  runFileTailRpc: (...args: any[]) => runFileTailRpcMock(...args),
}));

const listAllMcpToolsMock = vi.fn();
const callMcpToolOnServerMock = vi.fn();
vi.mock("../../mcp/localMcpClient.js", () => ({
  listAllMcpTools: (...args: any[]) => listAllMcpToolsMock(...args),
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

describe("rpcHandlers branch cover 2", () => {
  it("auth.confirmPin invalid_confirm_code branch", async () => {
    const ctx = makeBaseCtx({
      verifyPinCode: vi.fn().mockResolvedValue(true),
    });
    const r = (await handleRpc(ctx, "memeloop.auth.confirmPin", { confirmCode: "   " })) as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_confirm_code");
  });

  it("auth.exchangeJwt invalid jwt decode branch", async () => {
    const ctx = makeBaseCtx();
    const r = (await handleRpc(ctx, "memeloop.auth.exchangeJwt", { localJwt: "", remoteJwt: "" })) as any;
    expect(r.ok).toBe(false);
  });

  it("fileBaseDir routes all file.* RPCs when methods match", async () => {
    runFileReadRpcMock.mockResolvedValue({ ok: true, kind: "read" });
    runFileWriteRpcMock.mockResolvedValue({ ok: true, kind: "write" });
    runFileListRpcMock.mockResolvedValue({ ok: true, kind: "list" });
    runFileSearchRpcMock.mockResolvedValue({ ok: true, kind: "search" });
    runFileTailRpcMock.mockResolvedValue({ ok: true, kind: "tail" });

    const ctx = makeBaseCtx({
      fileBaseDir: "/tmp/root",
    });

    await expect(handleRpc(ctx, "memeloop.file.read", { path: "a.txt" })).resolves.toMatchObject({ kind: "read" });
    await expect(handleRpc(ctx, "memeloop.file.write", { path: "a.txt", text: "hi" })).resolves.toMatchObject({
      kind: "write",
    });
    await expect(handleRpc(ctx, "memeloop.file.list", { dir: "." })).resolves.toMatchObject({ kind: "list" });
    await expect(handleRpc(ctx, "memeloop.file.search", { query: "x" })).resolves.toMatchObject({ kind: "search" });
    await expect(handleRpc(ctx, "memeloop.file.tail", { path: "a.txt", n: 10 })).resolves.toMatchObject({ kind: "tail" });

    expect(runFileReadRpcMock).toHaveBeenCalledWith({ path: "a.txt" }, "/tmp/root");
    expect(runFileWriteRpcMock).toHaveBeenCalledWith({ path: "a.txt", text: "hi" }, "/tmp/root");
    expect(runFileListRpcMock).toHaveBeenCalledWith({ dir: "." }, "/tmp/root");
    expect(runFileSearchRpcMock).toHaveBeenCalledWith({ query: "x" }, "/tmp/root");
    expect(runFileTailRpcMock).toHaveBeenCalledWith({ path: "a.txt", n: 10 }, "/tmp/root");
  });

  it("mcp.listTools try/catch branches", async () => {
    const ctx = makeBaseCtx({
      mcpServers: [{ name: "s1", command: "cmd" }],
    });

    listAllMcpToolsMock.mockResolvedValueOnce([{ name: "t1" }]);
    await expect(handleRpc(ctx, "memeloop.mcp.listTools", {})).resolves.toEqual({ tools: [{ name: "t1" }] });

    listAllMcpToolsMock.mockRejectedValueOnce(new Error("fail"));
    await expect(handleRpc(ctx, "memeloop.mcp.listTools", {})).resolves.toMatchObject({
      error: expect.stringContaining("MCP listTools failed: fail"),
      tools: [],
    });
  });

  it("storage.getAttachmentBlob found=false branch when readAttachmentData returns empty", async () => {
    const ctx = makeBaseCtx({
      storage: {
        ...makeBaseCtx().storage,
        readAttachmentData: vi.fn().mockResolvedValue(new Uint8Array([])),
        getAttachment: vi.fn(),
      } as any,
    });
    const r = (await handleRpc(ctx, "memeloop.storage.getAttachmentBlob", { contentHash: "h1" })) as any;
    expect(r.found).toBe(false);
  });

  it("knowledge.query with empty query uses listTiddlers", async () => {
    const wikiManager = {
      search: vi.fn().mockResolvedValue([{ title: "s1" }]),
      listTiddlers: vi.fn().mockResolvedValue([{ title: "l1" }]),
    } as any;
    const ctx = makeBaseCtx({ wikiManager });
    const r = (await handleRpc(ctx, "memeloop.knowledge.query", { wikiId: "w" })) as any;
    expect(r.tiddlers).toEqual([{ title: "l1" }]);
    expect(wikiManager.search).not.toHaveBeenCalled();
    expect(wikiManager.listTiddlers).toHaveBeenCalledWith("w");
  });
});

