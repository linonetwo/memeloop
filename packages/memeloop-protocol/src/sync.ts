export type VersionVector = Record<string, number>;

export interface ConversationMeta {
  conversationId: string;
  title: string;
  lastMessagePreview: string;
  lastMessageTimestamp: number;
  messageCount: number;
  originNodeId: string;
  definitionId: string;
  instanceDelta?: Record<string, unknown>;
  isUserInitiated: boolean;
  sourceChannel?: {
    channelId: string;
    platform: string;
    imUserId: string;
  };
}

