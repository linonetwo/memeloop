import type { ImAgentDriver } from "./interface.js";
import type { IMChannelManager } from "./channelManager.js";

/**
 * IM 会话控制工具（计划 20.4）：在带 IM binding 的会话中注入。
 * 这里仅导出工具 schema 描述，实际注册由上层 ToolRegistry 完成。
 */
export const imToolDefinitions = [
  {
    name: "im.listConversations",
    description: "列出可切换的会话（占位：需接入存储层后返回真实列表）",
  },
  {
    name: "im.switchConversation",
    description: "切换当前 IM 用户绑定的活跃会话。参数：{ conversationId: string }",
  },
  {
    name: "im.newConversation",
    description: "创建新会话并切换绑定。参数：{ definitionId?: string, initialMessage?: string }",
  },
  {
    name: "im.summarizeHistory",
    description: "摘要当前会话历史（占位：需 LLM 调用）",
  },
] as const;

export interface ImToolsRuntime {
  channelId: string;
  imUserId: string;
  manager: IMChannelManager;
  driver: ImAgentDriver;
  defaultDefinitionId: string;
}

/** 供工具实现层调用的命令式 API（避免在 core 内耦合 defineTool） */
export async function imSwitchConversation(rt: ImToolsRuntime, conversationId: string): Promise<void> {
  await rt.manager.switchConversation(rt.channelId, rt.imUserId, conversationId);
}
