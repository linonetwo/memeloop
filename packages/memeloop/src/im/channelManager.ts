import type { ImChannelBindingRecord } from "../types.js";

import type { ImInboundMessage, ImAgentDriver, IIMAdapter } from "./interface.js";

export type { ImChannelBindingRecord };

/**
 * 管理 IM 用户与会话的绑定；可选 `storage` 使用 IAgentStorage 的 IM 绑定持久化。
 */
export class IMChannelManager {
  private readonly bindings = new Map<string, ImChannelBindingRecord>();

  constructor(
    private readonly storage?: {
      getImBinding?(c: string, u: string): Promise<ImChannelBindingRecord | null>;
      setImBinding?(r: ImChannelBindingRecord): Promise<void>;
    },
  ) {}

  private key(channelId: string, imUserId: string): string {
    return `${channelId}::${imUserId}`;
  }

  async getBinding(channelId: string, imUserId: string): Promise<ImChannelBindingRecord | undefined> {
    const k = this.key(channelId, imUserId);
    if (this.storage?.getImBinding) {
      const row = await this.storage.getImBinding(channelId, imUserId);
      if (row) {
        this.bindings.set(k, row);
        return row;
      }
    }
    return this.bindings.get(k);
  }

  async setBinding(record: ImChannelBindingRecord): Promise<void> {
    this.bindings.set(this.key(record.channelId, record.imUserId), record);
    if (this.storage?.setImBinding) {
      await this.storage.setImBinding(record);
    }
  }

  /**
   * 处理入站文本：无 binding 时创建会话并发送首条用户消息。
   */
  async dispatchInbound(
    msg: ImInboundMessage,
    driver: ImAgentDriver,
    options: { defaultDefinitionId: string },
  ): Promise<{ conversationId: string }> {
    const existing = await this.getBinding(msg.channelId, msg.imUserId);
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
    await this.setBinding({
      channelId: msg.channelId,
      imUserId: msg.imUserId,
      activeConversationId: conversationId,
      defaultDefinitionId: defId,
    });
    return { conversationId };
  }

  async switchConversation(channelId: string, imUserId: string, conversationId: string): Promise<void> {
    const cur = await this.getBinding(channelId, imUserId);
    if (cur) {
      await this.setBinding({ ...cur, activeConversationId: conversationId });
    } else {
      await this.setBinding({
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
