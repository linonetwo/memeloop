import type { BuiltinToolImpl } from "./types.js";

const TOOL_ID = "mcpClient";

export const mcpClientConfigSchema = {
  type: "object",
  properties: {
    nodeId: { type: "string", description: "Target node ID" },
    serverName: { type: "string", description: "MCP server name on that node" },
    toolName: { type: "string", description: "Tool to invoke" },
    args: { type: "object", description: "Tool arguments" },
  },
  required: ["nodeId", "serverName", "toolName"],
} as const;

export const mcpClientImpl: BuiltinToolImpl = async (args, context) => {
  const nodeId = args.nodeId as string | undefined;
  const serverName = args.serverName as string | undefined;
  const toolName = args.toolName as string | undefined;
  const toolArgs = (args.args as Record<string, unknown>) ?? {};

  if (!nodeId || !serverName || !toolName) {
    return {
      error: "mcpClient requires nodeId, serverName, and toolName",
    };
  }

  const mcpCall = context.mcpCallRemote;
  if (!mcpCall) {
    return {
      error: "MCP proxy not configured (no mcpCallRemote in context). Connect to nodes that expose MCP.",
    };
  }

  try {
    const result = await mcpCall(nodeId, serverName, toolName, toolArgs);
    return { result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `MCP call failed: ${message}` };
  }
};

export function getMcpClientToolId(): string {
  return TOOL_ID;
}
