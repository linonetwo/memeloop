import type { NodeStatus } from "@memeloop/protocol";

import type { AgentFrameworkContext } from "../../types.js";
import type { TaskAgentGenerator, TaskAgentInput } from "../../framework/taskAgent.js";

/**
 * Context passed to builtin tool implementations.
 * Extends AgentFrameworkContext with optional capabilities for MCP proxy, spawn and remote agent.
 */
export interface BuiltinToolContext extends AgentFrameworkContext {
  /**
   * Run the local task agent (for spawnAgent). If not provided, spawnAgent tool will return an error.
   */
  runLocalAgent?(input: TaskAgentInput): TaskAgentGenerator;

  /**
   * List known peer nodes (for remoteAgent). If not provided, remoteAgent returns empty list / "not configured".
   */
  getPeers?(): Promise<NodeStatus[]>;

  /**
   * Send JSON-RPC to a peer node (for remoteAgent and MCP proxy). If not provided, remote calls fail.
   */
  sendRpcToNode?(nodeId: string, method: string, params: unknown): Promise<unknown>;

  /**
   * Call a tool on a remote MCP server on the given node (for mcpClient). If not provided, mcpClient returns error.
   */
  mcpCallRemote?(
    nodeId: string,
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;

  /**
   * `remoteAgent` 等待远端流式输出的超时（毫秒）。默认 30000。
   */
  remoteAgentStreamTimeoutMs?: number;
}

/** Tool implementation: (args, context) => result. Context is bound at registration time. */
export type BuiltinToolImpl = (
  args: Record<string, unknown>,
  context: BuiltinToolContext,
) => Promise<unknown> | AsyncIterable<unknown>;
