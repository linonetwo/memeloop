import { describe, expect, it, vi, beforeEach } from "vitest";

const resolveQuestionAnswerMock = vi.hoisted(() => vi.fn());
vi.mock("memeloop", async () => {
  const actual = await vi.importActual<any>("memeloop");
  return {
    ...actual,
    resolveQuestionAnswer: resolveQuestionAnswerMock,
  };
});

const telegramVerifyMock = vi.hoisted(() => vi.fn());
const telegramParseMock = vi.hoisted(() => vi.fn());
const sendTelegramMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../telegramAdapter.js", () => ({
  TelegramIMAdapter: class TelegramIMAdapter {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_secret?: string) {}
    verify: typeof telegramVerifyMock = (...args: any[]) => telegramVerifyMock(...args);
    parse: typeof telegramParseMock = (...args: any[]) => telegramParseMock(...args);
  },
  sendTelegramTextMessage: (...args: any[]) => sendTelegramMock(...args),
}));

const verifyDiscordMock = vi.hoisted(() => vi.fn());
const parseDiscordMock = vi.hoisted(() => vi.fn());
const sendDiscordFollowupMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../discordAdapter.js", () => ({
  verifyDiscordInteraction: (...args: any[]) => verifyDiscordMock(...args),
  parseDiscordInteraction: (...args: any[]) => parseDiscordMock(...args),
  sendDiscordFollowup: (...args: any[]) => sendDiscordFollowupMock(...args),
}));

const handleLarkWebhookMock = vi.hoisted(() => vi.fn());
vi.mock("../larkAdapter.js", () => ({
  handleLarkWebhook: (...args: any[]) => handleLarkWebhookMock(...args),
}));

const wecomVerifyMock = vi.hoisted(() => vi.fn());
const wecomParseMock = vi.hoisted(() => vi.fn());
vi.mock("../wecomAdapter.js", () => ({
  verifyWecomUrl: () => null,
  WecomIMAdapter: class WecomIMAdapter {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_token?: string, _aes?: string, _corp?: string) {}
    verify: typeof wecomVerifyMock = (...args: any[]) => wecomVerifyMock(...args);
    parse: typeof wecomParseMock = (...args: any[]) => wecomParseMock(...args);
  },
}));

import type http from "node:http";
import { createImWebhookHandler } from "../createImWebhookHandler.js";
import { resolveQuestionAnswer } from "memeloop";

function makeRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as http.ServerResponse;
}

describe("createImWebhookHandler (branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // reset a few required default behaviors
    telegramVerifyMock.mockReturnValue(true);
    telegramParseMock.mockReturnValue(null);
    verifyDiscordMock.mockReturnValue(true);
    parseDiscordMock.mockReturnValue({ kind: "unsupported" });
    handleLarkWebhookMock.mockReturnValue({ kind: "unsupported" });
    wecomVerifyMock.mockReturnValue(true);
    wecomParseMock.mockReturnValue(null);
    resolveQuestionAnswerMock.mockReturnValue(true);
    sendDiscordFollowupMock.mockResolvedValue(undefined);
  });

  it("unknown channel returns 404", async () => {
    const handler = createImWebhookHandler({
      channels: [],
      manager: {} as any,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });
    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "nope", body: Buffer.from("") });
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("unknown channel");
  });

  it("telegram verify fails => 401", async () => {
    telegramVerifyMock.mockReturnValue(false);
    telegramParseMock.mockReturnValue(null);
    const manager = { dispatchInbound: vi.fn() } as any;
    const handler = createImWebhookHandler({
      channels: [{ channelId: "tg", platform: "telegram", botToken: "bt", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "tg", body: Buffer.from("x") });
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("unauthorized");
  });

  it("telegram slash bypasses pendingQuestionId route", async () => {
    telegramVerifyMock.mockReturnValue(true);
    telegramParseMock.mockReturnValue({
      channelId: "tg",
      platform: "telegram",
      imUserId: "u1",
      text: "/status",
      raw: {},
    });
    const manager = {
      getBinding: vi.fn().mockResolvedValue({
        pendingQuestionId: "q-1",
        imUserId: "u1",
        activeConversationId: "c-status",
      }),
      setBinding: vi.fn(),
      dispatchInbound: vi.fn().mockResolvedValue({ conversationId: "c1" }),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "tg", platform: "telegram", botToken: "bt", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn(), cancelAgent: vi.fn() } as any,
      storage: {
        getConversationMeta: vi.fn().mockResolvedValue({ definitionId: "d", messageCount: 0 }),
        listConversations: vi.fn().mockResolvedValue([]),
      } as any,
    });

    const res = makeRes();
    await handler({
      req: { headers: {} } as any,
      res,
      channelId: "tg",
      body: Buffer.from(JSON.stringify({})),
    });

    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    const sent = sendTelegramMock.mock.calls[0]?.[2] as string;
    expect(sent).toContain("c-status");
    expect(res.end).toHaveBeenCalledWith("ok");
  });

  it("telegram pendingQuestionId answers use resolveQuestionAnswer + setBinding", async () => {
    resolveQuestionAnswerMock.mockReturnValue(true);
    telegramVerifyMock.mockReturnValue(true);
    telegramParseMock.mockReturnValue({
      channelId: "tg",
      platform: "telegram",
      imUserId: "u1",
      text: "my answer",
      raw: {},
    });

    const existing = { pendingQuestionId: "q-1", imUserId: "u1" };
    const manager = {
      getBinding: vi.fn().mockResolvedValue(existing),
      setBinding: vi.fn().mockResolvedValue(undefined),
      dispatchInbound: vi.fn(),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "tg", platform: "telegram", botToken: "bt", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "tg", body: Buffer.from("{}") });

    expect(resolveQuestionAnswer).toHaveBeenCalledWith("q-1", "my answer");
    expect(manager.setBinding).toHaveBeenCalledWith({ ...existing, pendingQuestionId: undefined });
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    expect(sendTelegramMock).toHaveBeenCalledWith("bt", "u1", "已收到回答，继续执行…");
  });

  it("discord ping returns JSON type 1", async () => {
    verifyDiscordMock.mockReturnValue(true);
    parseDiscordMock.mockReturnValue({ kind: "ping" });
    const manager = { dispatchInbound: vi.fn() } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "d1", platform: "discord", discordPublicKey: "abc", botToken: "", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({
      req: { headers: {} } as any,
      res,
      channelId: "d1",
      body: Buffer.from("{}"),
      method: "POST",
    });

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ type: 1 }));
  });

  it("discord application_command triggers dispatch + followup (success)", async () => {
    verifyDiscordMock.mockReturnValue(true);
    parseDiscordMock.mockReturnValue({
      kind: "application_command",
      applicationId: "app1",
      token: "tok1",
      userId: "u1",
      text: "do it",
      raw: {},
    });
    const manager = {
      dispatchInbound: vi.fn().mockResolvedValue({ conversationId: "c1" }),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "d1", platform: "discord", discordPublicKey: "abc", botToken: "", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "d1", body: Buffer.from("{}"), method: "POST" });
    await new Promise((r) => setImmediate(r));

    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ type: 5 }));
    expect(manager.dispatchInbound).toHaveBeenCalled();
    expect(sendDiscordFollowupMock).toHaveBeenCalledWith("app1", "tok1", "已收到，正在处理…");
  });

  it("lark url_verification returns challenge", async () => {
    handleLarkWebhookMock.mockReturnValue({ kind: "url_verification", challenge: "ch" });
    const handler = createImWebhookHandler({
      channels: [{ channelId: "l1", platform: "lark", larkVerificationToken: "v", larkEncryptKey: "e", defaultDefinitionId: "d" } as any],
      manager: { dispatchInbound: vi.fn() } as any,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });
    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "l1", body: Buffer.from("{}") });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ challenge: "ch" }));
  });

  it("wecom unauthorized returns 401", async () => {
    wecomVerifyMock.mockReturnValue(false);
    const handler = createImWebhookHandler({
      channels: [{ channelId: "w1", platform: "wecom", wecomToken: "t", wecomEncodingAesKey: "aes", wecomCorpId: "c", defaultDefinitionId: "d" } as any],
      manager: { dispatchInbound: vi.fn() } as any,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });
    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "w1", body: Buffer.from("{}") });
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("unauthorized");
  });

  it("telegram empty inbound text returns ok without dispatch", async () => {
    telegramVerifyMock.mockReturnValue(true);
    telegramParseMock.mockReturnValue({
      channelId: "tg",
      platform: "telegram",
      imUserId: "u1",
      text: "   ",
      raw: {},
    });

    const manager = {
      getBinding: vi.fn(),
      setBinding: vi.fn(),
      dispatchInbound: vi.fn(),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "tg", platform: "telegram", botToken: "bt", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "tg", body: Buffer.from("x") });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("ok");
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
  });

  it("telegram pendingQuestionId answers branch ok=false", async () => {
    resolveQuestionAnswerMock.mockReturnValue(false);
    telegramVerifyMock.mockReturnValue(true);
    telegramParseMock.mockReturnValue({
      channelId: "tg",
      platform: "telegram",
      imUserId: "u1",
      text: "my answer",
      raw: {},
    });

    const existing = { pendingQuestionId: "q-1", imUserId: "u1" };
    const manager = {
      getBinding: vi.fn().mockResolvedValue(existing),
      setBinding: vi.fn().mockResolvedValue(undefined),
      dispatchInbound: vi.fn(),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "tg", platform: "telegram", botToken: "bt", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "tg", body: Buffer.from("{}") });

    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    expect(sendTelegramMock).toHaveBeenCalledWith("bt", "u1", "回答未被接受（可能已超时）");
  });

  it("discord application_command dispatch failure uses failure followup", async () => {
    verifyDiscordMock.mockReturnValue(true);
    parseDiscordMock.mockReturnValue({
      kind: "application_command",
      applicationId: "app1",
      token: "tok1",
      userId: "u1",
      text: "do it",
      raw: {},
    });

    const manager = {
      dispatchInbound: vi.fn().mockRejectedValue(new Error("boom")),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "d1", platform: "discord", discordPublicKey: "abc", botToken: "", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "d1", body: Buffer.from("{}"), method: "POST" });
    await new Promise((r) => setImmediate(r));

    // first end response for application_command type5, followup is async
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ type: 5 }));
    expect(sendDiscordFollowupMock).toHaveBeenCalledWith("app1", "tok1", expect.stringContaining("处理失败：boom"));
  });

  it("lark inbound dispatch throws but still returns 200 {}", async () => {
    handleLarkWebhookMock.mockReturnValue({
      kind: "inbound",
      message: { channelId: "l1", platform: "lark", imUserId: "u1", text: "hi", raw: {} },
    });

    const manager = {
      dispatchInbound: vi.fn().mockRejectedValue(new Error("dispatch boom")),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "l1", platform: "lark", larkVerificationToken: "v", larkEncryptKey: "e", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "l1", body: Buffer.from("{}") });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({}));
  });

  it("wecom GET verify failed returns 403", async () => {
    // wecomAdapter.verifyWecomUrl 在模块 mock 里默认返回 null，这里直接覆盖分支即可
    const handler = createImWebhookHandler({
      channels: [{ channelId: "w1", platform: "wecom", wecomToken: "t", wecomEncodingAesKey: "aes", wecomCorpId: "c", defaultDefinitionId: "d" } as any],
      manager: { dispatchInbound: vi.fn() } as any,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({
      req: { headers: {} } as any,
      res,
      channelId: "w1",
      method: "GET",
      queryString: "msg_signature=ms&timestamp=ts&nonce=no&echostr=echo",
      body: Buffer.from("{}"),
    } as any);

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("verify failed");
  });

  it("wecom inbound without text returns success (no dispatch)", async () => {
    wecomVerifyMock.mockReturnValue(true);
    wecomParseMock.mockReturnValue({
      channelId: "w1",
      platform: "wecom",
      imUserId: "u1",
      text: "   ",
      raw: {},
    });

    const manager = { dispatchInbound: vi.fn() } as any;
    const handler = createImWebhookHandler({
      channels: [
        { channelId: "w1", platform: "wecom", wecomToken: "t", wecomEncodingAesKey: "aes", wecomCorpId: "c", defaultDefinitionId: "d" } as any,
      ],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "w1", body: Buffer.from("{}") });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("success");
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
  });

  it("wecom dispatch failure is ignored and returns success", async () => {
    wecomVerifyMock.mockReturnValue(true);
    wecomParseMock.mockReturnValue({
      channelId: "w1",
      platform: "wecom",
      imUserId: "u1",
      text: "hi",
      raw: {},
    });

    const manager = { dispatchInbound: vi.fn().mockRejectedValue(new Error("dispatch failed")) } as any;
    const handler = createImWebhookHandler({
      channels: [
        { channelId: "w1", platform: "wecom", wecomToken: "t", wecomEncodingAesKey: "aes", wecomCorpId: "c", defaultDefinitionId: "d" } as any,
      ],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "w1", body: Buffer.from("{}") });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("success");
  });

  it("unsupported platform returns 501", async () => {
    const manager = { dispatchInbound: vi.fn() } as any;
    const handler = createImWebhookHandler({
      channels: [{ channelId: "x1", platform: "unknown" as any, defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "x1", body: Buffer.from("{}") });
    expect(res.writeHead).toHaveBeenCalledWith(501, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith("platform not supported");
  });

  it("telegram pendingQuestionId answers branch ok=true", async () => {
    resolveQuestionAnswerMock.mockReturnValue(true);
    telegramVerifyMock.mockReturnValue(true);
    telegramParseMock.mockReturnValue({
      channelId: "tg",
      platform: "telegram",
      imUserId: "u1",
      text: "my answer",
      raw: {},
    });

    const existing = { pendingQuestionId: "q-1", imUserId: "u1" };
    const manager = {
      getBinding: vi.fn().mockResolvedValue(existing),
      setBinding: vi.fn().mockResolvedValue(undefined),
      dispatchInbound: vi.fn(),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "tg", platform: "telegram", botToken: "bt", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "tg", body: Buffer.from("{}") });

    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    expect(sendTelegramMock).toHaveBeenCalledWith("bt", "u1", "已收到回答，继续执行…");
  });

  it("telegram normal dispatch path returns ok after dispatch", async () => {
    telegramVerifyMock.mockReturnValue(true);
    telegramParseMock.mockReturnValue({
      channelId: "tg",
      platform: "telegram",
      imUserId: "u1",
      text: "hello",
      raw: {},
    });

    const manager = {
      getBinding: vi.fn().mockResolvedValue({}),
      setBinding: vi.fn(),
      dispatchInbound: vi.fn().mockResolvedValue({ conversationId: "c1" }),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "tg", platform: "telegram", botToken: "bt", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: {
        createAgent: vi.fn(),
        sendMessage: vi.fn(),
        cancelAgent: vi.fn(),
        subscribeToUpdates: vi.fn().mockImplementation((_cid: string, fn: (u: unknown) => void) => {
          queueMicrotask(() => fn({ type: "agent-done" }));
          return () => {};
        }),
      } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "tg", body: Buffer.from("{}") });

    expect(manager.dispatchInbound).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith("ok");
  });

  it("telegram dispatch failure is caught and returns ok", async () => {
    telegramVerifyMock.mockReturnValue(true);
    telegramParseMock.mockReturnValue({
      channelId: "tg",
      platform: "telegram",
      imUserId: "u1",
      text: "hello",
      raw: {},
    });

    const manager = {
      getBinding: vi.fn().mockResolvedValue({}),
      setBinding: vi.fn(),
      dispatchInbound: vi.fn().mockRejectedValue(new Error("dispatch boom")),
    } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "tg", platform: "telegram", botToken: "bt", webhookSecret: "", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "tg", body: Buffer.from("{}") });

    expect(sendTelegramMock).toHaveBeenCalledWith("bt", "u1", expect.stringContaining("处理失败：dispatch boom"));
    expect(res.end).toHaveBeenCalledWith("ok");
  });

  it("lark inbound dispatch success returns 200 {}", async () => {
    handleLarkWebhookMock.mockReturnValue({
      kind: "inbound",
      message: { channelId: "l1", platform: "lark", imUserId: "u1", text: "hi", raw: {} },
    });

    const manager = { dispatchInbound: vi.fn().mockResolvedValue(undefined) } as any;
    const handler = createImWebhookHandler({
      channels: [{ channelId: "l1", platform: "lark", larkVerificationToken: "v", larkEncryptKey: "e", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "l1", body: Buffer.from("{}") });
    expect(manager.dispatchInbound).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({}));
  });

  it("lark unsupported kind returns 200 {} without throwing", async () => {
    handleLarkWebhookMock.mockReturnValue({ kind: "unsupported" });
    const manager = { dispatchInbound: vi.fn() } as any;

    const handler = createImWebhookHandler({
      channels: [{ channelId: "l1", platform: "lark", larkVerificationToken: "v", larkEncryptKey: "e", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "l1", body: Buffer.from("{}") });
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({}));
  });

  it("wecom parse returns null triggers success (no dispatch)", async () => {
    wecomVerifyMock.mockReturnValue(true);
    wecomParseMock.mockReturnValue(null);

    const manager = { dispatchInbound: vi.fn() } as any;
    const handler = createImWebhookHandler({
      channels: [{ channelId: "w1", platform: "wecom", wecomToken: "t", wecomEncodingAesKey: "aes", wecomCorpId: "c", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "w1", body: Buffer.from("{}") });
    expect(res.end).toHaveBeenCalledWith("success");
    expect(manager.dispatchInbound).not.toHaveBeenCalled();
  });

  it("wecom dispatch success returns success", async () => {
    wecomVerifyMock.mockReturnValue(true);
    wecomParseMock.mockReturnValue({ channelId: "w1", platform: "wecom", imUserId: "u1", text: "hi", raw: {} });

    const manager = { dispatchInbound: vi.fn().mockResolvedValue(undefined) } as any;
    const handler = createImWebhookHandler({
      channels: [{ channelId: "w1", platform: "wecom", wecomToken: "t", wecomEncodingAesKey: "aes", wecomCorpId: "c", defaultDefinitionId: "d" } as any],
      manager,
      runtime: { createAgent: vi.fn(), sendMessage: vi.fn() } as any,
      storage: {} as any,
    });

    const res = makeRes();
    await handler({ req: { headers: {} } as any, res, channelId: "w1", body: Buffer.from("{}") });
    expect(manager.dispatchInbound).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith("success");
  });
});

