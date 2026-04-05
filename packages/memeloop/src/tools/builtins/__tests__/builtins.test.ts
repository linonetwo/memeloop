import { describe, expect, it, vi } from "vitest";

import type {
  IAgentStorage,
  IChatSyncAdapter,
  ILLMProvider,
  INetworkService,
  IToolRegistry,
} from "../../../types.js";
import { MEMELOOP_STRUCTURED_TOOL_KEY } from "../../structuredToolResult.js";
import {
  registerBuiltinTools,
  mcpClientImpl,
  spawnAgentImpl,
  remoteAgentImpl,
  remoteAgentListImpl,
  ASK_QUESTION_TOOL_ID,
} from "../index.js";
import type { BuiltinToolContext } from "../types.js";

function createMinimalContext(overrides: Partial<BuiltinToolContext> = {}): BuiltinToolContext {
  const storage: IAgentStorage = {
    listConversations: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    upsertConversationMetadata: vi.fn().mockResolvedValue(undefined),
    insertMessagesIfAbsent: vi.fn().mockResolvedValue(undefined),
    getAttachment: vi.fn().mockResolvedValue(null),
    saveAttachment: vi.fn().mockResolvedValue(undefined),
    getAgentDefinition: vi.fn().mockResolvedValue(null),
    saveAgentInstance: vi.fn().mockResolvedValue(undefined),
    getConversationMeta: vi.fn().mockResolvedValue(null),
  };
  const llmProvider: ILLMProvider = {
    name: "mock",
    chat: vi.fn().mockResolvedValue([]),
  };
  const tools: IToolRegistry = {
    registerTool: vi.fn(),
    getTool: vi.fn(),
    listTools: vi.fn().mockReturnValue([]),
  };
  const syncAdapters: IChatSyncAdapter[] = [];
  const network: INetworkService = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  return {
    storage,
    llmProvider,
    tools,
    syncAdapters,
    network,
    ...overrides,
  };
}

describe("builtin tools", () => {
  describe("registerBuiltinTools", () => {
    it("registers mcpClient, spawnAgent, remoteAgent, askQuestion with registry and schema", () => {
      const registry: IToolRegistry = {
        registerTool: vi.fn(),
        getTool: vi.fn(),
        listTools: vi.fn().mockReturnValue([]),
      };
      const context = createMinimalContext();
      registerBuiltinTools(registry, context);
      expect(registry.registerTool).toHaveBeenCalledWith("mcpClient", expect.any(Function));
      expect(registry.registerTool).toHaveBeenCalledWith("spawnAgent", expect.any(Function));
      expect(registry.registerTool).toHaveBeenCalledWith("remoteAgent", expect.any(Function));
      expect(registry.registerTool).toHaveBeenCalledWith(
        ASK_QUESTION_TOOL_ID,
        expect.any(Function),
      );
    });

    it("does not register node-environment tools in core builtins", () => {
      const registry: IToolRegistry = {
        registerTool: vi.fn(),
        getTool: vi.fn(),
        listTools: vi.fn().mockReturnValue([]),
      };
      const context = createMinimalContext();
      registerBuiltinTools(registry, context);
      const allCalls = (
        registry.registerTool as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.map((c) => c[0]);
      expect(allCalls).not.toContain("terminal.execute");
      expect(allCalls).not.toContain("file.read");
      expect(allCalls).not.toContain("knowledge.wikiSearch");
    });
  });

  describe("mcpClientImpl", () => {
    it("returns error when mcpCallRemote not configured", async () => {
      const context = createMinimalContext();
      const result = (await mcpClientImpl(
        { nodeId: "n1", serverName: "s1", toolName: "t1" },
        context,
      )) as { error?: string };
      expect(result.error).toContain("MCP proxy not configured");
    });

    it("returns error when required args missing", async () => {
      const context = createMinimalContext();
      const result = (await mcpClientImpl({}, context)) as { error?: string };
      expect(result.error).toContain("nodeId");
    });
  });

  describe("spawnAgentImpl", () => {
    it("returns error when runLocalAgent not configured", async () => {
      const context = createMinimalContext();
      const result = (await spawnAgentImpl(
        { definitionId: "def1", message: "hello" },
        context,
      )) as { error?: string };
      expect(result.error).toContain("Local agent runner not configured");
    });

    it("returns __memeloopToolResult with sub-agent detailRef when runLocalAgent succeeds", async () => {
      async function* runLocal(): AsyncIterable<{ type: "message"; data: string }> {
        yield { type: "message", data: "sub output" };
      }
      const context = createMinimalContext({
        runLocalAgent: runLocal,
        localNodeId: "node-a",
      });
      const result = (await spawnAgentImpl(
        { definitionId: "def1", message: "hi" },
        context,
      )) as Record<string, unknown>;
      expect(result.summary).toBe("sub output");
      expect(typeof result.conversationId).toBe("string");
      expect(result.conversationId).toMatch(/^spawn:def1:/);
      const structured = result[MEMELOOP_STRUCTURED_TOOL_KEY] as {
        summary: string;
        detailRef: { type: string; conversationId: string; nodeId: string };
      };
      expect(structured.summary).toBe("sub output");
      expect(structured.detailRef.type).toBe("sub-agent");
      expect(structured.detailRef.nodeId).toBe("node-a");
      expect(structured.detailRef.conversationId).toBe(result.conversationId);
    });

    it("handles object message chunks / no-text fallback / runner error", async () => {
      async function* runLocalObj(): AsyncIterable<{ type: "message"; data: unknown }> {
        yield { type: "message", data: { content: "obj-output" } };
      }
      const okCtx = createMinimalContext({ runLocalAgent: runLocalObj });
      const ok = (await spawnAgentImpl({ definitionId: "def1", message: "hi" }, okCtx)) as Record<
        string,
        unknown
      >;
      expect(ok.summary).toBe("obj-output");

      async function* runLocalEmpty(): AsyncIterable<{ type: "thinking"; data: string }> {
        yield { type: "thinking", data: "..." };
      }
      const emptyCtx = createMinimalContext({ runLocalAgent: runLocalEmpty as any });
      const empty = (await spawnAgentImpl(
        { definitionId: "def1", message: "hi" },
        emptyCtx,
      )) as Record<string, unknown>;
      expect(empty.summary).toBe("(no text output)");

      const badCtx = createMinimalContext({
        runLocalAgent: (() => {
          throw new Error("boom");
        }) as any,
      });
      const err = (await spawnAgentImpl({ definitionId: "def1", message: "hi" }, badCtx)) as {
        error?: string;
      };
      expect(err.error).toContain("spawnAgent failed");
    });
  });

  describe("remoteAgentImpl", () => {
    it("returns __memeloopToolResult with sub-agent detailRef when RPC succeeds", async () => {
      const sendRpc = vi
        .fn()
        .mockResolvedValueOnce({ conversationId: "remote-conv-1" })
        .mockResolvedValueOnce(undefined);
      const context = createMinimalContext({ sendRpcToNode: sendRpc });
      const result = (await remoteAgentImpl(
        { nodeId: "peer1", definitionId: "d1", message: "m1" },
        context,
      )) as Record<string, unknown>;
      expect(sendRpc).toHaveBeenCalledWith("peer1", "memeloop.agent.create", expect.any(Object));
      expect(sendRpc).toHaveBeenCalledWith("peer1", "memeloop.agent.send", expect.any(Object));
      expect(result.remoteNodeId).toBe("peer1");
      expect(result.remoteConversationId).toBe("remote-conv-1");
      const structured = result[MEMELOOP_STRUCTURED_TOOL_KEY] as {
        summary: string;
        detailRef: { type: string; conversationId: string; nodeId: string };
      };
      expect(structured.detailRef.type).toBe("sub-agent");
      expect(structured.detailRef.nodeId).toBe("peer1");
      expect(structured.detailRef.conversationId).toBe("remote-conv-1");
    });

    it("covers list fallback, missing conversationId and rpc failure", async () => {
      const listCtx = createMinimalContext({
        getPeers: async () => [{ identity: { nodeId: "n1", name: "N1" }, status: "online" }],
      } as any);
      const list = await remoteAgentImpl({}, listCtx);
      expect((list as any).nodes).toBeDefined();

      const missingConv = createMinimalContext({
        sendRpcToNode: vi.fn().mockResolvedValueOnce({}),
      });
      const r1 = await remoteAgentImpl(
        { nodeId: "n1", definitionId: "d1", message: "m1" },
        missingConv,
      );
      expect((r1 as any).error).toContain("did not return conversationId");

      const rpcFail = createMinimalContext({
        sendRpcToNode: vi.fn().mockRejectedValue(new Error("rpc-bad")),
      });
      const r2 = await remoteAgentImpl(
        { nodeId: "n1", definitionId: "d1", message: "m1" },
        rpcFail,
      );
      expect((r2 as any).error).toContain("remoteAgent failed");
    });
  });

  describe("remoteAgentListImpl", () => {
    it("returns empty nodes when getPeers not configured", async () => {
      const context = createMinimalContext();
      const result = (await remoteAgentListImpl({}, context)) as {
        nodes: unknown[];
        error?: string;
      };
      expect(result.nodes).toEqual([]);
      expect(result.error).toBeDefined();
    });

    it("returns peer list when getPeers provided", async () => {
      const context = createMinimalContext({
        getPeers: async () => [
          {
            identity: { nodeId: "n1", userId: "u1", name: "Node1", type: "node" as const },
            capabilities: { tools: [], mcpServers: [], hasWiki: false, imChannels: [], wikis: [] },
            connectivity: {},
            status: "online" as const,
            lastSeen: Date.now(),
          },
        ],
      });
      const result = (await remoteAgentListImpl({}, context)) as {
        nodes: { nodeId: string; name: string }[];
      };
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].nodeId).toBe("n1");
      expect(result.nodes[0].name).toBe("Node1");
    });

    it("fetches agent definitions from remote nodes via RPC", async () => {
      const mockDefinitions = [
        { id: "def1", name: "Definition 1" },
        { id: "def2", name: "Definition 2" },
      ];
      const sendRpc = vi.fn().mockResolvedValue({ definitions: mockDefinitions });
      const context = createMinimalContext({
        getPeers: async () => [
          {
            identity: { nodeId: "n1", userId: "u1", name: "Node1", type: "node" as const },
            capabilities: { tools: [], mcpServers: [], hasWiki: false, imChannels: [], wikis: [] },
            connectivity: {},
            status: "online" as const,
            lastSeen: Date.now(),
          },
        ],
        sendRpcToNode: sendRpc,
      });
      const result = (await remoteAgentListImpl({}, context)) as {
        nodes: { nodeId: string; name: string; definitions?: unknown[] }[];
      };
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].definitions).toEqual(mockDefinitions);
      expect(sendRpc).toHaveBeenCalledWith("n1", "memeloop.agent.getDefinitions", {});
    });

    it("handles RPC errors gracefully when fetching definitions", async () => {
      const sendRpc = vi.fn().mockRejectedValue(new Error("RPC failed"));
      const context = createMinimalContext({
        getPeers: async () => [
          {
            identity: { nodeId: "n1", userId: "u1", name: "Node1", type: "node" as const },
            capabilities: { tools: [], mcpServers: [], hasWiki: false, imChannels: [], wikis: [] },
            connectivity: {},
            status: "online" as const,
            lastSeen: Date.now(),
          },
        ],
        sendRpcToNode: sendRpc,
      });
      const result = (await remoteAgentListImpl({}, context)) as {
        nodes: { nodeId: string; name: string; definitions?: unknown[] }[];
      };
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].definitions).toEqual([]);
    });
  });
});
