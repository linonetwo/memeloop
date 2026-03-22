import type { ImInboundMessage, ImAgentDriver, IIMAdapter } from "./interface.js";

export interface ImChannelBindingRecord {
  channelId: string;
  imUserId: string;
  activeConversationId: string;
  defaultDefinitionId?: string;
}

/**
 * 管理 IM 用户与会话的绑定；当前为内存实现（节点进程内）。
 * 后续可换为 SQLite 持久化。
 */
export class IMChannelManager {
  private readonly bindings = new Map<string, ImChannelBindingRecord>();

  private key(channelId: string, imUserId: string): string {
    return `${channelId}::${imUserId}`;
  }

  getBinding(channelId: string, imUserId: string): ImChannelBindingRecord | undefined {
    return this.bindings.get(this.key(channelId, imUserId));
  }

  setBinding(record: ImChannelBindingRecord): void {
    this.bindings.set(this.key(record.channelId, record.imUserId), record);
  }

  /**
   * 处理入站文本：无 binding 时创建会话并发送首条用户消息。
   */
  async dispatchInbound(
    msg: ImInboundMessage,
    driver: ImAgentDriver,
    options: { defaultDefinitionId: string },
  ): Promise<{ conversationId: string }> {
    const existing = this.getBinding(msg.channelId, msg.imUserId);
    if (existing) {
      await driver.sendMessage({
        conversationId: existing.activeConversationId,
        message: msg.text,
      });
      return { conversationId: existing.activeConversationId };
    }
    const defId = options.defaultDefinitionId;
    const { conversationId } = await driver.createAgent({
      definitionId: defId,
      initialMessage: msg.text,
    });
    this.setBinding({
      channelId: msg.channelId,
      imUserId: msg.imUserId,
      activeConversationId: conversationId,
      defaultDefinitionId: defId,
    });
    return { conversationId };
  }

  switchConversation(channelId: string, imUserId: string, conversationId: string): void {
    const cur = this.getBinding(channelId, imUserId);
    if (cur) {
      this.setBinding({ ...cur, activeConversationId: conversationId });
    } else {
      this.setBinding({
        channelId,
        imUserId,
        activeConversationId: conversationId,
      });
    }
  }
}

export function pickAdapter(adapters: IIMAdapter[], platform: string): IIMAdapter | undefined {
  return adapters.find((a) => a.platform === platform);
}
