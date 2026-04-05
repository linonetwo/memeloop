import type { ChatMessage, ConversationMeta } from "@memeloop/protocol";

import type { ChatSyncPeer } from "./chatSyncEngine.js";

export interface PeerNodeTransport {
  nodeId: string;
  exchangeVersionVector(
    targetNodeId: string,
    localVersion: Record<string, number>,
  ): Promise<{
    remoteVersion: Record<string, number>;
    missingForRemote: ConversationMeta[];
  }>;
  pullMissingMetadata(
    targetNodeId: string,
    sinceVersion: Record<string, number>,
  ): Promise<ConversationMeta[]>;
  pullMissingMessages?(
    targetNodeId: string,
    conversationId: string,
    knownMessageIds: string[],
  ): Promise<ChatMessage[]>;

  /** 从指定节点拉取附件 BLOB（如 `memeloop.storage.getAttachmentBlob`）。 */
  pullAttachmentBlob?(
    targetNodeId: string,
    contentHash: string,
  ): Promise<{ data: Uint8Array; filename: string; mimeType: string; size: number } | null>;
}

export class PeerNodeSyncAdapter implements ChatSyncPeer {
  public readonly nodeId: string;
  private readonly transport: PeerNodeTransport;

  constructor(nodeId: string, transport: PeerNodeTransport) {
    this.nodeId = nodeId;
    this.transport = transport;
  }

  exchangeVersionVector(localVersion: Record<string, number>) {
    return this.transport.exchangeVersionVector(this.nodeId, localVersion);
  }

  pullMissingMetadata(sinceVersion: Record<string, number>) {
    return this.transport.pullMissingMetadata(this.nodeId, sinceVersion);
  }

  pullMissingMessages(conversationId: string, knownMessageIds: string[]): Promise<ChatMessage[]> {
    const fn = this.transport.pullMissingMessages;
    if (!fn) {
      return Promise.resolve([]);
    }
    return fn(this.nodeId, conversationId, knownMessageIds);
  }

  pullAttachmentBlob(contentHash: string) {
    const fn = this.transport.pullAttachmentBlob;
    if (!fn) {
      return Promise.resolve(null);
    }
    return fn(this.nodeId, contentHash);
  }
}

