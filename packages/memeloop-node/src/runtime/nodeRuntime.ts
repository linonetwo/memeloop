import path from "node:path";

import {
  SQLiteAgentStorage,
  ProviderRegistry,
  createMemeLoopRuntime,
  registerBuiltinTools,
  createTaskAgent,
  ChatSyncEngine,
  PeerNodeSyncAdapter,
  getBuiltinAgentDefinitions,
  type MemeLoopRuntime,
  type IAgentStorage,
  type INetworkService,
  type AgentFrameworkContext,
} from "memeloop";

import type { NodeConfig } from "../config";
import { normalizeAgentDefinition } from "../config";
import type { ITerminalSessionManager } from "../terminal";
import type { PeerConnectionManager } from "../network/peerConnectionManager";
import { ToolRegistry } from "./toolRegistry";
import { createRegistryLLMProvider } from "./llmAdapter";
import { createFetchLLMProvider } from "./fetchProvider";
import { registerTerminalTools } from "../tools/terminal";
import { registerFileTools } from "../tools/fileSystem";
import { registerWikiTools } from "../tools/wikiTools";
import { registerVscodeTools } from "../tools/vscodeCli";
import { registerGenericNodeTools } from "../tools/genericNodeTools";
import { FileWikiManager, type IWikiManager } from "../knowledge/wikiManager";
import { createPeerRpcSyncTransport } from "../network/rpcSyncTransport";
import type { AgentDefinition } from "@memeloop/protocol";

export interface NodeRuntimeOptions {
  config: NodeConfig;
  /** Data directory for SQLite file */
  dataDir: string;
  /** Stable node id（ChatSyncEngine、sync RPC 时钟键；与 cloud 注册 id 对齐） */
  localNodeId?: string;
  /** If provided, terminal tools (terminal.execute / list / respond) are registered */
  terminalManager?: ITerminalSessionManager;
  /** Base directory for file.* tools (default cwd) */
  fileBaseDir?: string;
  /** Wiki base path (config.wikiPath); if set, knowledge.* wiki tools are registered */
  wikiBasePath?: string;
  /**
   * 出站 peer 连接（LAN/Desktop 已 `addPeerByUrl` 后），用于 builtin：`getPeers` / `sendRpcToNode` /
   * `mcpCallRemote` / `remoteAgent`。
   */
  peerConnectionManager?: PeerConnectionManager;
  /** 覆盖 config.remoteAgentStreamTimeoutMs */
  remoteAgentStreamTimeoutMs?: number;
  /** 从 Wiki 加载带 MemeLoop AgentDefinition 标签的 tiddler（默认仅 default wiki） */
  wikiAgentDefinitionWikiIds?: string[];
}

export interface NodeRuntimeResult {
  runtime: MemeLoopRuntime;
  storage: IAgentStorage;
  providerRegistry: ProviderRegistry;
  toolRegistry: ToolRegistry;
  context: AgentFrameworkContext;
  wikiManager?: IWikiManager;
  /** 供 RPC `memeloop.agent.getDefinitions` 使用 */
  agentDefinitions: AgentDefinition[];
  /** 与 `file.*` RPC 一致的根目录 */
  fileBaseDirResolved: string;
  /** 已连接 peer 时可用于 `syncEngine.syncOnce()` */
  syncEngine?: ChatSyncEngine;
  /** Wiki 中 Agent 定义变更后可调用以合并进内存与 SQLite */
  refreshWikiAgentDefinitions?: () => Promise<void>;
}

const noopNetwork: INetworkService = {
  async start() {},
  async stop() {},
};

/**
 * Build MemeLoopRuntime + SQLiteAgentStorage + ProviderRegistry + IToolRegistry
 * with tool permission allowlist/blocklist from config.
 */
export function createNodeRuntime(options: NodeRuntimeOptions): NodeRuntimeResult {
  const { config, dataDir } = options;

  const dbPath = path.join(dataDir, "memeloop.db");
  const storage: IAgentStorage = new SQLiteAgentStorage({ filename: dbPath });

  const builtinDefs = getBuiltinAgentDefinitions();
  const fromConfig = (config.agents ?? []).map(normalizeAgentDefinition);
  const definitionById = new Map<string, AgentDefinition>();
  for (const d of builtinDefs) {
    definitionById.set(d.id, d);
  }
  for (const d of fromConfig) {
    definitionById.set(d.id, d);
  }
  const agentDefinitions: AgentDefinition[] = [];
  const rebuildAgentDefinitionsList = (): void => {
    agentDefinitions.length = 0;
    agentDefinitions.push(...definitionById.values());
  };
  rebuildAgentDefinitionsList();
  if (storage instanceof SQLiteAgentStorage) {
    storage.seedAgentDefinitions(agentDefinitions);
  }

  const providerRegistry = new ProviderRegistry();
  for (const entry of config.providers ?? []) {
    const provider = createFetchLLMProvider(entry);
    providerRegistry.register(provider);
  }
  const defaultModelId = config.providers?.[0]?.name ?? "default";
  const llmProvider = createRegistryLLMProvider(providerRegistry, defaultModelId);

  const toolRegistry = new ToolRegistry(config.tools);

  const conversationCancellation = new Set<string>();
  const context: AgentFrameworkContext = {
    storage,
    llmProvider,
    tools: toolRegistry,
    syncAdapters: [],
    network: noopNetwork,
    logger: {
      warn: (...a: unknown[]) => console.warn("[memeloop-node]", ...a),
      error: (...a: unknown[]) => console.error("[memeloop-node]", ...a),
    },
    taskAgent: {
      maxIterations: 32,
      isCancelled: (cid) => conversationCancellation.has(cid),
    },
    conversationCancellation,
    resolveAgentDefinition: async (definitionId) => {
      const hit = definitionById.get(definitionId);
      if (hit) return hit;
      return storage.getAgentDefinition(definitionId);
    },
  };

  const runLocalAgent = createTaskAgent(context);
  context.runTaskAgent = runLocalAgent;

  const peerMgr = options.peerConnectionManager;
  const streamTimeout =
    options.remoteAgentStreamTimeoutMs ??
    config.remoteAgentStreamTimeoutMs ??
    30_000;

  registerBuiltinTools(toolRegistry, {
    ...context,
    runLocalAgent,
    getPeers: peerMgr ? async () => peerMgr.getPeers() : undefined,
    sendRpcToNode: peerMgr
      ? (nodeId, method, params) => peerMgr.sendRpcToNode(nodeId, method, params)
      : undefined,
    mcpCallRemote: peerMgr
      ? async (nodeId, serverName, toolName, args) =>
          peerMgr.sendRpcToNode(nodeId, "memeloop.mcp.callTool", {
            serverName,
            toolName,
            arguments: args,
          })
      : undefined,
    remoteAgentStreamTimeoutMs: streamTimeout,
  });

  if (options.terminalManager) {
    registerTerminalTools(toolRegistry, options.terminalManager);
  }
  const fileBaseResolved = options.fileBaseDir ?? process.cwd();
  registerFileTools(toolRegistry, fileBaseResolved);

  let wikiManager: IWikiManager | undefined;
  let refreshWikiAgentDefinitions: (() => Promise<void>) | undefined;
  if (options.wikiBasePath) {
    wikiManager = new FileWikiManager(options.wikiBasePath);
    registerWikiTools(toolRegistry, wikiManager, "default");
    const wikiIds =
      options.wikiAgentDefinitionWikiIds?.length && options.wikiAgentDefinitionWikiIds.length > 0
        ? options.wikiAgentDefinitionWikiIds
        : ["default"];
    refreshWikiAgentDefinitions = async () => {
      for (const wid of wikiIds) {
        wikiManager!.clearWikiCache(wid);
      }
      for (const wid of wikiIds) {
        const defs = await wikiManager!.listAgentDefinitionsFromWiki(wid);
        for (const d of defs) {
          definitionById.set(d.id, d);
        }
      }
      rebuildAgentDefinitionsList();
      if (storage instanceof SQLiteAgentStorage) {
        storage.seedAgentDefinitions(agentDefinitions);
      }
    };
    void refreshWikiAgentDefinitions().catch((e) => {
      context.logger?.warn?.("wiki agent definitions load failed", e);
    });
  }
  registerVscodeTools(toolRegistry);
  registerGenericNodeTools(toolRegistry);

  const runtime = createMemeLoopRuntime(context);

  const syncNodeId = (options.localNodeId ?? config.nodeId ?? "memeloop-local").trim() || "memeloop-local";
  let syncEngine: ChatSyncEngine | undefined;
  if (peerMgr) {
    const transport = createPeerRpcSyncTransport((nid, method, params) =>
      peerMgr.sendRpcToNode(nid, method, params),
    );
    syncEngine = new ChatSyncEngine({
      nodeId: syncNodeId,
      storage,
      peers: () => peerMgr.getPeerNodeIds().map((id) => new PeerNodeSyncAdapter(id, transport)),
    });
  }

  return {
    runtime,
    storage,
    providerRegistry,
    toolRegistry,
    context,
    wikiManager,
    agentDefinitions,
    fileBaseDirResolved: fileBaseResolved,
    syncEngine,
    refreshWikiAgentDefinitions,
  };
}
