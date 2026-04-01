import type http from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createImWebhookHandler } from "../createImWebhookHandler.js";
import { createNodeServer } from "../../network/nodeServer.js";
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

async function listenRandom(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("failed to bind test server");
  return addr.port;
}

describe("IM webhook integration (real HTTP server)", () => {
  let server: http.Server | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("POST /im/webhook/:channelId routes slash before pendingQuestionId", async () => {
    const channelId = "tg-ch";
    const runtime = {
      createAgent: vi.fn().mockResolvedValue({ conversationId: "c1" }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelAgent: vi.fn().mockResolvedValue(undefined),
      subscribeToUpdates: vi.fn().mockReturnValue(() => {}),
    } as unknown as MemeLoopRuntime;
    const storage = {
      getConversationMeta: vi.fn().mockResolvedValue({ definitionId: "memeloop:general-assistant", messageCount: 1 }),
      listConversations: vi.fn().mockResolvedValue([]),
    } as unknown as IAgentStorage;
    const manager = {
      getBinding: vi.fn().mockResolvedValue({
        channelId,
        imUserId: "123",
        activeConversationId: "c1",
        pendingQuestionId: "q1",
      }),
      setBinding: vi.fn().mockResolvedValue(undefined),
      dispatchInbound: vi.fn().mockResolvedValue({ conversationId: "c1" }),
    } as any;

    const imWebhookHandler = createImWebhookHandler({
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

    server = createNodeServer({
      port: 0,
      nodeId: "node-test",
      rpcContext: {} as any,
      imWebhookHandler,
    });
    const port = await listenRandom(server);

    const resp = await fetch(`http://127.0.0.1:${port}/im/webhook/${channelId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: { text: "/status", chat: { id: 123 } } }),
    });

    expect(resp.status).toBe(200);
    expect(resolveQuestionAnswer).not.toHaveBeenCalled();
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    const body = (sendTelegramTextMessage as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as string;
    expect(body).toContain("c1");
  });

  it("POST /im/webhook/:channelId routes pendingQuestionId answers", async () => {
    (resolveQuestionAnswer as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const channelId = "tg-ch";
    const runtime = {
      createAgent: vi.fn().mockResolvedValue({ conversationId: "c1" }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelAgent: vi.fn().mockResolvedValue(undefined),
      subscribeToUpdates: vi.fn().mockReturnValue(() => {}),
    } as unknown as MemeLoopRuntime;
    const storage = {} as unknown as IAgentStorage;
    const existing = {
      channelId,
      imUserId: "u1",
      activeConversationId: "c1",
      pendingQuestionId: "q-1",
    };
    const manager = {
      getBinding: vi.fn().mockResolvedValue(existing),
      setBinding: vi.fn().mockResolvedValue(undefined),
      dispatchInbound: vi.fn().mockResolvedValue({ conversationId: "c1" }),
    } as any;

    const imWebhookHandler = createImWebhookHandler({
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

    server = createNodeServer({
      port: 0,
      nodeId: "node-test",
      rpcContext: {} as any,
      imWebhookHandler,
    });
    const port = await listenRandom(server);

    const resp = await fetch(`http://127.0.0.1:${port}/im/webhook/${channelId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: { text: "my answer", chat: { id: "u1" } } }),
    });

    expect(resp.status).toBe(200);
    expect(resolveQuestionAnswer).toHaveBeenCalledWith("q-1", "my answer");
    expect(manager.setBinding).toHaveBeenCalledWith({ ...existing, pendingQuestionId: undefined });
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    expect(sendTelegramTextMessage).toHaveBeenCalledWith("bot-token", "u1", "已收到回答，继续执行…");
  });
});

