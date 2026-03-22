import type { BuiltinToolContext, BuiltinToolImpl } from "./types.js";

const TOOL_ID = "remoteAgent";

export const remoteAgentConfigSchema = {
  type: "object",
  properties: {
    nodeId: { type: "string", description: "Target node ID to run the sub-agent on" },
    definitionId: { type: "string", description: "Agent definition ID on that node" },
    message: { type: "string", description: "Task message for the remote agent" },
  },
  required: ["nodeId", "definitionId", "message"],
} as const;

/** List nodes and their definitions (for tool description / agent choice). No args. */
export const remoteAgentListImpl: BuiltinToolImpl = async (_args, context) => {
  const getPeers = context.getPeers;
  const sendRpc = context.sendRpcToNode;

  if (!getPeers) {
    return { nodes: [], error: "Peer list not configured (no getPeers)." };
  }

  const peers = await getPeers();
  const online = peers.filter((p) => p.status === "online");
  const result: { nodeId: string; name: string; definitions?: unknown[] }[] = [];

  for (const node of online) {
    const entry: { nodeId: string; name: string; definitions?: unknown[] } = {
      nodeId: node.identity.nodeId,
      name: node.identity.name,
    };
    if (sendRpc) {
      try {
        const defs = await sendRpc(node.identity.nodeId, "memeloop.agent.getDefinitions", {});
        entry.definitions = Array.isArray(defs) ? defs : defs != null ? [defs] : [];
      } catch {
        entry.definitions = [];
      }
    }
    result.push(entry);
  }

  return { nodes: result };
};

export const remoteAgentImpl: BuiltinToolImpl = async (args, context) => {
  const nodeId = args.nodeId as string | undefined;
  const definitionId = args.definitionId as string | undefined;
  const message = args.message as string | undefined;

  if (!nodeId || !definitionId || typeof message !== "string") {
    return remoteAgentListImpl(args, context);
  }

  const sendRpc = context.sendRpcToNode;
  if (!sendRpc) {
    return {
      error: "Remote node RPC not configured (no sendRpcToNode). Connect to peer nodes first.",
    };
  }

  try {
    const createResult = await sendRpc(nodeId, "memeloop.agent.create", {
      definitionId,
      initialMessage: message,
    }) as { conversationId?: string };
    const conversationId = createResult?.conversationId;
    if (!conversationId) {
      return { error: "Remote agent.create did not return conversationId", raw: createResult };
    }

    await sendRpc(nodeId, "memeloop.agent.send", {
      conversationId,
      message,
    });

    const subscribeStream = (context as BuiltinToolContext & {
      subscribeRemoteStream?: (nodeId: string, conversationId: string, onChunk: (chunk: unknown) => void) => () => void;
    }).subscribeRemoteStream;
    const streamWaitMs = context.remoteAgentStreamTimeoutMs ?? 30_000;
    const chunks: string[] = [];
    if (subscribeStream) {
      await new Promise<void>((resolve) => {
        const unsub = subscribeStream!(nodeId, conversationId, (chunk) => {
          if (typeof chunk === "string") chunks.push(chunk);
          else if (chunk != null && typeof chunk === "object" && "content" in (chunk as object))
            chunks.push(String((chunk as { content?: unknown }).content ?? ""));
        });
        setTimeout(() => {
          unsub();
          resolve();
        }, streamWaitMs);
      });
    }

    const summary = chunks.length > 0
      ? chunks.join("").trim()
      : "(task dispatched; stream not configured or no output yet)";
    return {
      summary,
      remoteNodeId: nodeId,
      remoteConversationId: conversationId,
      definitionId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `remoteAgent failed: ${message}` };
  }
};

export function getRemoteAgentToolId(): string {
  return TOOL_ID;
}
