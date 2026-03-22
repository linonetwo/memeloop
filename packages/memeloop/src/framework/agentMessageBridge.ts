/**
 * ChatMessage（协议）↔ AgentInstanceMessage（TidGi / defineTool）桥接。
 */
import type { ChatMessage } from "@memeloop/protocol";

import type { AgentInstanceMessage } from "../types.js";
import { nextLamportClockForConversation } from "../storage/nextLamport.js";
import type { IAgentStorage } from "../types.js";

export function chatMessagesToAgentMessages(conversationId: string, messages: ChatMessage[]): AgentInstanceMessage[] {
  return messages.map((m) => ({
    id: m.messageId,
    agentId: conversationId,
    role: m.role as AgentInstanceMessage["role"],
    content: m.content,
    created: new Date(m.timestamp),
    modified: new Date(m.timestamp),
  }));
}

export async function agentInstanceMessageToChatMessage(
  storage: IAgentStorage,
  conversationId: string,
  originNodeId: string,
  m: AgentInstanceMessage,
): Promise<ChatMessage> {
  const lamportClock = await nextLamportClockForConversation(storage, conversationId);
  const role =
    m.role === "user" || m.role === "assistant" || m.role === "tool"
      ? m.role
      : m.role === "agent"
        ? "assistant"
        : "user";
  return {
    messageId: m.id,
    conversationId,
    originNodeId,
    timestamp: m.created?.getTime() ?? Date.now(),
    lamportClock,
    role: role as ChatMessage["role"],
    content: m.content,
  };
}
