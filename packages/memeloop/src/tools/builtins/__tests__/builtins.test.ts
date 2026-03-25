import { describe, expect, it, vi } from "vitest";

import type {
  IAgentStorage,
  IChatSyncAdapter,
  ILLMProvider,
  INetworkService,
  IToolRegistry,
} from "../../../types.js";
import {
  registerBuiltinTools,
  mcpClientImpl,
  spawnAgentImpl,
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
      expect(registry.registerTool).toHaveBeenCalledWith(ASK_QUESTION_TOOL_ID, expect.any(Function));
    });

    it("does not register node-environment tools in core builtins", () => {
      const registry: IToolRegistry = {
        registerTool: vi.fn(),
        getTool: vi.fn(),
        listTools: vi.fn().mockReturnValue([]),
      };
      const context = createMinimalContext();
      registerBuiltinTools(registry, context);
      const allCalls = (registry.registerTool as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(allCalls).not.toContain("terminal.execute");
      expect(allCalls).not.toContain("file.read");
      expect(allCalls).not.toContain("knowledge.wikiSearch");
    });
  });

  describe("mcpClientImpl", () => {
    it("returns error when mcpCallRemote not configured", async () => {
      const context = createMinimalContext();
      const result = await mcpClientImpl(
        { nodeId: "n1", serverName: "s1", toolName: "t1" },
        context,
      ) as { error?: string };
      expect(result.error).toContain("MCP proxy not configured");
    });

    it("returns error when required args missing", async () => {
      const context = createMinimalContext();
      const result = await mcpClientImpl({}, context) as { error?: string };
      expect(result.error).toContain("nodeId");
    });
  });

  describe("spawnAgentImpl", () => {
    it("returns error when runLocalAgent not configured", async () => {
      const context = createMinimalContext();
      const result = await spawnAgentImpl(
        { definitionId: "def1", message: "hello" },
        context,
      ) as { error?: string };
      expect(result.error).toContain("Local agent runner not configured");
    });
  });

  describe("remoteAgentListImpl", () => {
    it("returns empty nodes when getPeers not configured", async () => {
      const context = createMinimalContext();
      const result = await remoteAgentListImpl({}, context) as { nodes: unknown[]; error?: string };
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
      const result = await remoteAgentListImpl({}, context) as { nodes: { nodeId: string; name: string }[] };
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].nodeId).toBe("n1");
      expect(result.nodes[0].name).toBe("Node1");
    });
  });
});
