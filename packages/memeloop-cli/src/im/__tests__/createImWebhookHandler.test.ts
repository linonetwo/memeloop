import { describe, expect, it, vi, beforeEach } from "vitest";

import { createImWebhookHandler } from "../createImWebhookHandler.js";
import type { IAgentStorage, MemeLoopRuntime } from "memeloop";

vi.mock("memeloop", async () => {
  const actual = await vi.importActual<any>("memeloop");
  return {
    ...actual,
    resolveQuestionAnswer: vi.fn(),
  };
});

vi.mock("../telegramAdapter.js", async () => {
  const actual = await vi.importActual<any>("../telegramAdapter.js");
  return {
    ...actual,
    sendTelegramTextMessage: vi.fn().mockResolvedValue(undefined),
  };
});

import { resolveQuestionAnswer } from "memeloop";
import { sendTelegramTextMessage } from "../telegramAdapter.js";

function makeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}

describe("createImWebhookHandler (telegram)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes slash commands before pendingQuestionId", async () => {
    const channelId = "ch1";
    const runtime = {
      createAgent: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelAgent: vi.fn().mockResolvedValue(undefined),
      subscribeToUpdates: vi.fn().mockReturnValue(() => {}),
    } as unknown as MemeLoopRuntime;
    const storage = {
      getConversationMeta: vi.fn().mockResolvedValue({ definitionId: "memeloop:general-assistant", messageCount: 2 }),
      listConversations: vi.fn().mockResolvedValue([]),
    } as unknown as IAgentStorage;

    const manager = {
      getBinding: vi.fn().mockResolvedValue({
        channelId,
        imUserId: "u1",
        activeConversationId: "conv-1",
        pendingQuestionId: "q1",
      }),
      setBinding: vi.fn().mockResolvedValue(undefined),
      dispatchInbound: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
    } as any;

    const handler = createImWebhookHandler({
      channels: [
        {
          channelId,
          platform: "telegram",
          botToken: "bot-token",
          webhookSecret: "",
          defaultDefinitionId: "memeloop:general-assistant",
        },
      ],
      manager,
      runtime,
      storage,
    });

    const req = { headers: {} } as any;
    const res = makeRes();
    const body = Buffer.from(JSON.stringify({ message: { text: "/status", chat: { id: 123 } } }), "utf8");

    await handler({
      req,
      res,
      channelId,
      body,
      method: "POST",
      queryString: "",
    });

    expect(resolveQuestionAnswer).not.toHaveBeenCalled();
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    const sent = (sendTelegramTextMessage as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as string;
    expect(sent).toContain("会话：conv-1");
    expect(res.end).toHaveBeenCalledWith("ok");
  });

  it("routes pendingQuestionId answers via resolveQuestionAnswer and clears pendingQuestionId", async () => {
    (resolveQuestionAnswer as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const channelId = "ch1";
    const runtime = {
      createAgent: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelAgent: vi.fn().mockResolvedValue(undefined),
      subscribeToUpdates: vi.fn().mockReturnValue(() => {}),
    } as unknown as MemeLoopRuntime;
    const storage = {} as unknown as IAgentStorage;

    const existing = {
      channelId,
      imUserId: "u1",
      activeConversationId: "conv-1",
      pendingQuestionId: "q1",
    };

    const manager = {
      getBinding: vi.fn().mockResolvedValue(existing),
      setBinding: vi.fn().mockResolvedValue(undefined),
      dispatchInbound: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
    } as any;

    const handler = createImWebhookHandler({
      channels: [
        {
          channelId,
          platform: "telegram",
          botToken: "bot-token",
          webhookSecret: "",
          defaultDefinitionId: "memeloop:general-assistant",
        },
      ],
      manager,
      runtime,
      storage,
    });

    const req = { headers: {} } as any;
    const res = makeRes();
    const body = Buffer.from(JSON.stringify({ message: { text: "my answer", chat: { id: "u1" } } }), "utf8");

    await handler({
      req,
      res,
      channelId,
      body,
      method: "POST",
      queryString: "",
    });

    expect(resolveQuestionAnswer).toHaveBeenCalledWith("q1", "my answer");
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    expect(manager.setBinding).toHaveBeenCalledWith({ ...existing, pendingQuestionId: undefined });
    expect(sendTelegramTextMessage).toHaveBeenCalledWith("bot-token", "u1", "已收到回答，继续执行…");
    expect(res.end).toHaveBeenCalledWith("ok");
  });
});

