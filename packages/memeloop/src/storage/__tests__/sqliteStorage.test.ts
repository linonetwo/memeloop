import { describe, expect, it } from "vitest";

import type { AttachmentRef, ChatMessage, ConversationMeta } from "@memeloop/protocol";

import { SQLiteAgentStorage } from "../sqliteStorage.js";

function createConversationMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    conversationId: "c1",
    title: "Test",
    lastMessagePreview: "hi",
    lastMessageTimestamp: Date.now(),
    messageCount: 1,
    originNodeId: "node-1",
    definitionId: "memeloop:test",
    isUserInitiated: true,
    ...overrides,
  };
}

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: "m1",
    conversationId: "c1",
    originNodeId: "node-1",
    timestamp: Date.now(),
    lamportClock: 1,
    role: "user",
    content: "hello",
    ...overrides,
  };
}

describe("SQLiteAgentStorage", () => {
  it("lists conversations metadata-only", async () => {
    const storage = new SQLiteAgentStorage();
    const meta = createConversationMeta();

    // 直接插入一条 conversation 行，模拟已有会话
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = (storage as any).db;
    db.prepare(
      `
      INSERT INTO conversations (
        conversationId, title, lastMessagePreview, lastMessageTimestamp,
        messageCount, originNodeId, definitionId,
        instanceDeltaJson, isUserInitiated, sourceChannelJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
    ).run(
      meta.conversationId,
      meta.title,
      meta.lastMessagePreview,
      meta.lastMessageTimestamp,
      meta.messageCount,
      meta.originNodeId,
      meta.definitionId,
      null,
      meta.isUserInitiated ? 1 : 0,
      null,
    );

    const list = await storage.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].conversationId).toBe("c1");

    const one = await storage.getConversationMeta("c1");
    expect(one?.definitionId).toBe("memeloop:test");
    expect(await storage.getConversationMeta("missing")).toBeNull();
  });

  it("appends and reads messages by conversation", async () => {
    const storage = new SQLiteAgentStorage();
    const msg1 = createMessage({ messageId: "m1", content: "hello" });
    const msg2 = createMessage({ messageId: "m2", content: "world", lamportClock: 2 });

    await storage.appendMessage(msg1);
    await storage.appendMessage(msg2);

    const msgs = await storage.getMessages("c1", { mode: "full-content" });
    expect(msgs.map((m) => m.messageId)).toEqual(["m1", "m2"]);
  });

  it("upserts conversation metadata and insertMessagesIfAbsent merges without duplicate", async () => {
    const storage = new SQLiteAgentStorage();
    const meta = createConversationMeta({ conversationId: "c-merge", messageCount: 0 });
    await storage.upsertConversationMetadata(meta);
    const m1 = createMessage({
      conversationId: "c-merge",
      messageId: "mid-1",
      lamportClock: 1,
    });
    const m2 = createMessage({
      conversationId: "c-merge",
      messageId: "mid-2",
      lamportClock: 2,
    });
    await storage.insertMessagesIfAbsent([m1, m2]);
    await storage.insertMessagesIfAbsent([m1]);
    const msgs = await storage.getMessages("c-merge");
    expect(msgs).toHaveLength(2);
    const list = await storage.listConversations();
    const row = list.find((c) => c.conversationId === "c-merge");
    expect(row?.messageCount).toBe(2);
  });

  it("saves and reads attachments by contentHash", async () => {
    const storage = new SQLiteAgentStorage();
    const ref: AttachmentRef = {
      contentHash: "sha256:abc",
      filename: "a.txt",
      mimeType: "text/plain",
      size: 3,
    };

    await storage.saveAttachment(ref, Buffer.from("abc"));

    const loaded = await storage.getAttachment(ref.contentHash);
    expect(loaded).not.toBeNull();
    expect(loaded?.filename).toBe("a.txt");
  });
});

