import type { IToolRegistry } from "../../types.js";
import { registerBuiltinPromptPlugins } from "../../prompt/builtinPromptPlugins.js";
import { pluginRegistry } from "../pluginRegistry.js";
import { registerToolParameterSchema } from "../schemaRegistry.js";

import type { BuiltinToolContext } from "./types.js";
import { getMcpClientToolId, mcpClientConfigSchema, mcpClientImpl } from "./mcpClient.js";
import { getRemoteAgentToolId, remoteAgentConfigSchema, remoteAgentImpl } from "./remoteAgent.js";
import { getSpawnAgentToolId, spawnAgentConfigSchema, spawnAgentImpl } from "./spawnAgent.js";
import { ASK_QUESTION_TOOL_ID, askQuestionConfigSchema, askQuestionImpl } from "./askQuestion.js";
export { mcpClientImpl, mcpClientConfigSchema, getMcpClientToolId } from "./mcpClient.js";
export { remoteAgentImpl, remoteAgentConfigSchema, remoteAgentListImpl, getRemoteAgentToolId } from "./remoteAgent.js";
export { spawnAgentImpl, spawnAgentConfigSchema, getSpawnAgentToolId } from "./spawnAgent.js";
export { askQuestionImpl, askQuestionConfigSchema, ASK_QUESTION_TOOL_ID } from "./askQuestion.js";
export { resolveQuestionAnswer } from "./questionWaitRegistry.js";
export type { BuiltinToolContext, BuiltinToolImpl } from "./types.js";
export {
  IM_SESSION_TOOL_IDS,
  registerImSessionBuiltinTools,
  type ImSessionBuiltinRegistration,
} from "./imBuiltinTools.js";

/**
 * Register MCP client, spawnAgent, and remoteAgent builtin tools with the registry.
 * Call this when building AgentFrameworkContext so that getTool("mcpClient") etc. work.
 */
export function registerBuiltinTools(registry: IToolRegistry, context: BuiltinToolContext): void {
  const promptDest = registry.getPromptPlugins?.();
  if (promptDest) {
    for (const [id, tool] of pluginRegistry) {
      promptDest.set(id, tool);
    }
    registerBuiltinPromptPlugins(promptDest);
  } else {
    registerBuiltinPromptPlugins();
  }
  registry.registerTool(
    getMcpClientToolId(),
    (args: Record<string, unknown>) => mcpClientImpl(args, context),
  );
  registry.registerTool(
    getSpawnAgentToolId(),
    (args: Record<string, unknown>) => spawnAgentImpl(args, context),
  );
  registry.registerTool(
    getRemoteAgentToolId(),
    (args: Record<string, unknown>) => remoteAgentImpl(args, context),
  );
  registry.registerTool(ASK_QUESTION_TOOL_ID, (args: Record<string, unknown>) => askQuestionImpl(args, context));

  registerToolParameterSchema(getMcpClientToolId(), mcpClientConfigSchema, {
    displayName: "MCP Client",
    description: "Call a tool on a remote MCP server (transparent proxy). Requires nodeId, serverName, toolName, and optional args.",
  });
  registerToolParameterSchema(getSpawnAgentToolId(), spawnAgentConfigSchema, {
    displayName: "Spawn Agent",
    description: "Run a local sub-agent with the given definition and message. Returns summary.",
  });
  registerToolParameterSchema(getRemoteAgentToolId(), remoteAgentConfigSchema, {
    displayName: "Remote Agent",
    description: "Create and run a sub-agent on a remote node. Requires nodeId, definitionId, message. List nodes with no args.",
  });
  registerToolParameterSchema(ASK_QUESTION_TOOL_ID, askQuestionConfigSchema, {
    displayName: "Ask Question",
    description:
      "Block until the user answers (via memeloop.agent.resolveQuestion RPC). Args: question, conversationId, optional timeoutMs.",
  });
}
