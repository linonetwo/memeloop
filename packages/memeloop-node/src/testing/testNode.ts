import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ChatMessage } from "@memeloop/protocol";
import type { WsAuthOptions } from "memeloop";

import type { NodeConfig } from "../config";
import { createNodeRuntime } from "../runtime/index";
import type { RpcHandlerContext } from "../network";
import { startNodeServerWithMdns } from "../network";
import type { ITerminalSessionManager } from "../terminal";

export interface StartedTestNode {
  server: http.Server;
  port: number;
  nodeId: string;
  /** Register an extra tool on this node (e.g. Cucumber / integration tests). */
  registerTool(id: string, impl: (args: Record<string, unknown>) => unknown | Promise<unknown>): void;
  /** Read persisted messages for a conversation (TaskAgent + runtime). */
  getConversationMessages(conversationId: string): Promise<ChatMessage[]>;
}

function createTempDir(prefix: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return base;
}

export async function startTestNode(
  nodeId: string,
  options?: {
    port?: number;
    config?: Partial<NodeConfig>;
    dataDir?: string;
    terminalManager?: ITerminalSessionManager;
    wikiBasePath?: string;
    wsAuth?: WsAuthOptions;
  },
): Promise<StartedTestNode> {
  const config: NodeConfig = {
    name: nodeId,
    providers: [],
    tools: { allowlist: [], blocklist: [] },
    ...(options?.config ?? {}),
  };
  const dataDir = options?.dataDir ?? createTempDir(`memeloop-node-${nodeId}-`);
  const { runtime, storage, wikiManager, toolRegistry, agentDefinitions, fileBaseDirResolved } =
    createNodeRuntime({
      config,
      dataDir,
      fileBaseDir: dataDir,
      terminalManager: options?.terminalManager,
      wikiBasePath: options?.wikiBasePath,
      localNodeId: nodeId,
    });
  const rpcContext: RpcHandlerContext = {
    runtime,
    storage,
    terminalManager: options?.terminalManager,
    wikiManager,
    toolRegistry,
    nodeId,
    mcpServers: (config.mcpServers ?? []).map((s) => ({ name: s.name, command: s.command, args: s.args })),
    agentDefinitions,
    fileBaseDir: fileBaseDirResolved,
  };

  const server = await startNodeServerWithMdns({
    port: options?.port ?? 0,
    nodeId,
    rpcContext,
    serviceName: nodeId,
    wsAuth: options?.wsAuth,
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }

  return {
    server,
    port: address.port,
    nodeId,
    registerTool(id: string, impl: (args: Record<string, unknown>) => unknown | Promise<unknown>) {
      toolRegistry.registerTool(id, impl);
    },
    getConversationMessages(conversationId: string) {
      return storage.getMessages(conversationId, { mode: "full-content" });
    },
  };
}

