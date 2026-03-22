import type { AttachmentRef } from "./attachment.js";

export type ChatRole = "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  toolName: string;
  arguments: unknown;
}

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  originNodeId: string;
  timestamp: number;
  lamportClock: number;
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  attachments?: AttachmentRef[];
}

