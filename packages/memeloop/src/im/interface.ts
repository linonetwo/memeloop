/**
 * IM 接入框架（平台无关）：适配器负责验签/解析；ChannelManager 负责会话路由。
 */

import type { IMPlatformType } from "@memeloop/protocol";

export type { IMPlatformType };

/** 平台 Webhook 解析后的统一入站消息 */
export interface ImInboundMessage {
  channelId: string;
  platform: IMPlatformType;
  imUserId: string;
  text: string;
  /** 平台原始结构，便于调试或扩展富媒体 */
  raw: unknown;
}

export interface ImWebhookContext {
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** GET/POST query（如企业微信密文回调的 msg_signature、timestamp、nonce） */
  query?: Record<string, string>;
}

/**
 * 单平台适配器：verify 失败应返回 false；parse 失败返回 null。
 */
export interface IIMAdapter {
  readonly platform: IMPlatformType;
  verify(ctx: ImWebhookContext): boolean;
  parse(channelId: string, ctx: ImWebhookContext): ImInboundMessage | null;
}

/** 将 Agent 输出格式化为 IM 可发送的纯文本 */
export interface IIMMessageRenderer {
  renderPlainText(content: string): string;
  renderToolCall(toolName: string, args: unknown): string;
  renderToolResult(toolName: string, result: unknown): string;
  renderToolApproval(toolName: string, args: unknown): string;
  renderAskQuestion(question: string, options?: string[]): string;
  renderThinking(content: string): string;
  renderError(error: string): string;
  renderTodoList(todos: Array<{ id: string; text: string; done?: boolean }>): string;
}

/** 节点侧驱动 Agent 的最小能力（避免循环依赖 MemeLoopRuntime 类型） */
export interface ImAgentDriver {
  createAgent(options: { definitionId: string; initialMessage?: string }): Promise<{ conversationId: string }>;
  sendMessage(options: { conversationId: string; message: string }): Promise<void>;
}
