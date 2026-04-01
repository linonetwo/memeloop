import type { IAgentStorage, ImAgentDriver, MemeLoopRuntime } from "memeloop";

/**
 * 为经 IM 入站的会话写入 `ConversationMeta.sourceChannel`，以便 `im.*` 工具与额外 system 提示生效。
 */
export function createImTaggedDriver(
  runtime: MemeLoopRuntime,
  storage: IAgentStorage,
  source: { channelId: string; platform: string; imUserId: string },
): ImAgentDriver {
  const tagIfNeeded = async (conversationId: string): Promise<void> => {
    const meta = await storage.getConversationMeta(conversationId);
    if (!meta || meta.sourceChannel) return;
    await storage.upsertConversationMetadata({
      ...meta,
      sourceChannel: {
        channelId: source.channelId,
        platform: source.platform,
        imUserId: source.imUserId,
      },
    });
  };

  return {
    async createAgent(opts) {
      const r = await runtime.createAgent(opts);
      await tagIfNeeded(r.conversationId);
      return r;
    },
    async sendMessage(opts) {
      await runtime.sendMessage(opts);
      await tagIfNeeded(opts.conversationId);
    },
  };
}
