import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: {} as any,
  saved: null as any,
  startNodeServerWithMdns: vi.fn().mockResolvedValue(undefined),
  createNodeRuntime: vi.fn(),
  cloudClient: {
    getJwt: vi.fn().mockResolvedValue({ accessToken: "jwt-x" }),
    getJwtByChallenge: vi.fn().mockResolvedValue({ accessToken: "jwt-x" }),
    registerNode: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
  },
  registerWithOtp: vi.fn().mockResolvedValue({ nodeId: "node-x", nodeSecret: "sec-x" }),
}));

const imGetBindingMock = vi.hoisted(() => vi.fn());
const imSetBindingMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  watch: vi.fn(),
}));

vi.mock("../auth/keypair.js", () => ({
  getDefaultKeypairPath: () => "/tmp/keypair.json",
  loadOrCreateNodeKeypair: vi.fn().mockReturnValue({
    nodeId: "kp-node-id",
    x25519PublicKey: "x-pub",
    x25519PrivateKey: "x-priv",
    ed25519PublicKey: "e-pub",
    ed25519PrivateKey: "e-priv",
    createdAt: 1,
  }),
}));

vi.mock("../auth/noiseKeypair.js", () => ({
  nodeKeypairToNoiseStaticKeyPair: vi.fn().mockReturnValue({
    publicKey: Buffer.alloc(32, 7),
    secretKey: Buffer.alloc(32, 8),
  }),
}));

vi.mock("../im/telegramAdapter.js", () => ({
  sendTelegramTextMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../network/lanAutoConnect.js", () => ({
  autoConnectDiscoveredPeer: vi.fn(),
}));

vi.mock("../config", () => ({
  getDefaultConfigPath: () => "/tmp/memeloop-node.yaml",
  loadConfig: () => state.config,
  saveConfig: (cfg: any) => {
    state.saved = cfg;
  },
}));

vi.mock("../auth/wsAuth.js", () => ({
  createLanPinWsAuth: () => ({ mode: "lan-pin" }),
}));

vi.mock("../auth/index.js", () => ({
  CloudClient: class CloudClient {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_url: string) {}
    registerWithOtp(code: string) {
      return state.registerWithOtp(code);
    }
    getJwt = state.cloudClient.getJwt;
    getJwtByChallenge = state.cloudClient.getJwtByChallenge;
    registerNode = state.cloudClient.registerNode;
    heartbeat = state.cloudClient.heartbeat;
  },
  buildRegistrationPayload: vi.fn().mockReturnValue({}),
}));

vi.mock("../runtime/index.js", () => ({
  createNodeRuntime: (...args: any[]) => state.createNodeRuntime(...args),
}));

vi.mock("../terminal/index.js", () => ({
  TerminalSessionManager: class TerminalSessionManager {},
}));

vi.mock("../network/index.js", () => ({
  PeerConnectionManager: class PeerConnectionManager {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_opts: any) {}
  },
  startNodeServerWithMdns: (...args: any[]) => state.startNodeServerWithMdns(...args),
}));

vi.mock("../im/createImWebhookHandler.js", () => ({
  createImWebhookHandler: vi.fn().mockReturnValue(undefined),
}));

vi.mock("memeloop", async () => {
  const actual = await vi.importActual<any>("memeloop");
  return {
    ...actual,
    IMChannelManager: class IMChannelManager {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_storage: any) {}
      getBinding = imGetBindingMock;
      setBinding = imSetBindingMock;
    },
    browse: vi.fn(),
    ConnectivityManager: class ConnectivityManager {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_port: number) {}
      detectPublicIP = vi.fn().mockResolvedValue(undefined);
    },
  };
});

function setArgv(args: string[]) {
  process.argv = ["node", "memeloop", ...args];
}

async function runCli(args: string[]) {
  setArgv(args);
  vi.resetModules();
  await import("../cli.js");
  // Commander action handlers are async; give event loop a tick.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("cli", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.config = {};
    state.saved = null;
    state.createNodeRuntime.mockReset().mockReturnValue({
      runtime: {},
      storage: { getConversationMeta: vi.fn() },
      toolRegistry: {},
      wikiManager: undefined,
      agentDefinitions: [],
      fileBaseDirResolved: "/tmp",
      refreshWikiAgentDefinitions: undefined,
    });
    state.startNodeServerWithMdns.mockReset().mockResolvedValue(undefined);
    state.registerWithOtp.mockReset().mockResolvedValue({ nodeId: "node-x", nodeSecret: "sec-x" });
    state.cloudClient.getJwt.mockReset().mockResolvedValue({ accessToken: "jwt-x" });
    state.cloudClient.getJwtByChallenge.mockReset().mockResolvedValue({ accessToken: "jwt-x" });
    state.cloudClient.registerNode.mockReset().mockResolvedValue(undefined);
    state.cloudClient.heartbeat.mockReset().mockResolvedValue(undefined);
    imGetBindingMock.mockReset();
    imSetBindingMock.mockReset();

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    exitSpy = vi
      .spyOn(process, "exit")
      // commander action 内部不会在 process.exit 后 return；为了避免未捕获异常/未处理 promise，
      // 这里用 no-op 阻止真正退出，但仍能断言 process.exit 被调用以覆盖分支。
      .mockImplementation(((_code?: number) => undefined) as any);

    setIntervalSpy = vi
      .spyOn(global, "setInterval")
      .mockImplementation(((fn: any, _ms?: number) => {
        // 不真正启动定时器，避免测试挂住。
        void fn;
        return 0 as any;
      }) as any);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    setIntervalSpy.mockRestore();
  });

  it("status prints config summary", async () => {
    state.config = { name: "n1", providers: [{ name: "p1" }], tools: { allowlist: ["a"], blocklist: [] } };
    await runCli(["status"]);
    expect(logSpy).toHaveBeenCalled();
  });

  it("register success saves nodeId/nodeSecret", async () => {
    state.config = { cloudUrl: "https://cloud.example" };
    await runCli(["register", "--otp", "123456"]);
    expect(state.saved.nodeId).toBe("node-x");
    expect(state.saved.nodeSecret).toBe("sec-x");
  });

  it("register missing otp triggers exit", async () => {
    state.config = { cloudUrl: "https://cloud.example" };
    await runCli(["register", "--config", "/tmp/memeloop-node.yaml"]);
    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("register missing cloud url triggers exit", async () => {
    state.config = {};
    await runCli(["register", "--otp", "123456", "--config", "/tmp/memeloop-node.yaml"]);
    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("register with otp failure triggers exit", async () => {
    state.config = { cloudUrl: "https://cloud.example" };
    state.registerWithOtp.mockRejectedValueOnce(new Error("boom"));
    await runCli(["register", "--otp", "123456", "--config", "/tmp/memeloop-node.yaml"]);
    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("im add/list/remove command flow", async () => {
    state.config = { im: { channels: [] } };
    await runCli(["im", "add", "--platform", "telegram", "--token", "bt"]);
    expect(state.saved.im.channels.length).toBe(1);

    state.config = state.saved;
    await runCli(["im", "list"]);
    expect(logSpy).toHaveBeenCalled();

    const channelId = state.config.im.channels[0].channelId;
    await runCli(["im", "remove", channelId]);
    expect(state.saved.im.channels.find((c: any) => c.channelId === channelId)).toBeUndefined();
  });

  it("im add unsupported platform triggers exit", async () => {
    state.config = { im: { channels: [] } };
    await runCli(["im", "add", "--platform", "nope", "--token", "bt", "--config", "/tmp/memeloop-node.yaml"]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Unsupported platform:"), "nope");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("start command wires runtime/server and prints startup log", async () => {
    state.config = {
      name: "node-a",
      providers: [],
      tools: { allowlist: [], blocklist: [] },
      im: { channels: [] },
    };
    process.env.NODE_ENV = "test";
    await runCli(["start", "--port", "38472", "--data-dir", "/tmp"]);
    expect(state.createNodeRuntime).toHaveBeenCalled();
    expect(state.startNodeServerWithMdns).toHaveBeenCalled();
  });

  it("start with cloudUrl+nodeSecret schedules heartbeat", async () => {
    state.config = {
      name: "node-a",
      cloudUrl: "https://cloud.example",
      nodeSecret: "sec-x",
      providers: [],
      tools: { allowlist: [], blocklist: [] },
      im: { channels: [] },
    };
    process.env.NODE_ENV = "test"; // 不走 mdns 分支

    // 让 setInterval 立即执行一次回调，覆盖 cli.ts 里 heartbeat 行。
    setIntervalSpy.mockImplementation(((fn: any, _ms?: number) => {
      fn();
      return 0 as any;
    }) as any);

    await runCli(["start", "--port", "38472", "--data-dir", "/tmp"]);
    expect(state.cloudClient.heartbeat).toHaveBeenCalledWith(expect.any(String), "jwt-x");
  });

  it("start with wikiPath and refreshWikiAgentDefinitions wires fs.watch (success path)", async () => {
    state.config = {
      name: "node-a",
      providers: [],
      tools: { allowlist: [], blocklist: [] },
      wikiPath: "wiki",
      im: { channels: [] },
    };

    const refreshFn = vi.fn().mockResolvedValue(undefined);
    state.createNodeRuntime.mockReset().mockReturnValue({
      runtime: {},
      storage: { getConversationMeta: vi.fn() },
      toolRegistry: {},
      wikiManager: undefined,
      agentDefinitions: [],
      fileBaseDirResolved: "/tmp",
      refreshWikiAgentDefinitions: refreshFn,
    });

    process.env.NODE_ENV = "test"; // 不走 mdns 和 cloud 注册的额外分支
    const fsMod = await import("node:fs");
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    const realSetTimeout = global.setTimeout;
    const setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation(((fn: any, ms?: number, ...args: any[]) => {
      // Only fast-forward the wiki debounce timer.
      if (ms === 900) {
        fn(...args);
        return 1 as any;
      }
      return realSetTimeout(fn, ms as any, ...args);
    }) as any);

    let scheduleCb: any;
    (fsMod.watch as any).mockImplementationOnce((_path: any, _opts: any, cb: any) => {
      scheduleCb = cb;
      return undefined;
    });

    try {
      await runCli(["start", "--port", "38472", "--data-dir", "/tmp"]);
      expect((fsMod.watch as any).mock.calls.length).toBeGreaterThan(0);

      // Trigger debounce schedule twice to cover clearTimeout(debounce) branch.
      scheduleCb();
      scheduleCb();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(refreshFn).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    }
  });

  it("start with wikiPath and refreshWikiAgentDefinitions covers fs.watch error catch", async () => {
    state.config = {
      name: "node-a",
      providers: [],
      tools: { allowlist: [], blocklist: [] },
      wikiPath: "wiki",
      im: { channels: [] },
    };

    state.createNodeRuntime.mockReset().mockReturnValue({
      runtime: {},
      storage: { getConversationMeta: vi.fn() },
      toolRegistry: {},
      wikiManager: undefined,
      agentDefinitions: [],
      fileBaseDirResolved: "/tmp",
      refreshWikiAgentDefinitions: vi.fn().mockResolvedValue(undefined),
    });

    process.env.NODE_ENV = "test";
    const fsMod = await import("node:fs");
    (fsMod.watch as any).mockImplementationOnce(() => {
      throw new Error("watch fail");
    });

    await runCli(["start", "--port", "38472", "--data-dir", "/tmp"]);
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("watch fail"));
  });

  it("start covers LAN mdns path (NODE_ENV!=test)", async () => {
    state.config = {
      name: "node-a",
      providers: [],
      tools: { allowlist: [], blocklist: [] },
      im: { channels: [] },
    };
    process.env.NODE_ENV = "production";
    delete process.env.MEMELOOP_DISABLE_MDNS;

    // 让 browse 立即触发 onServiceUp，覆盖 autoConnectDiscoveredPeer 的分支行。
    const memeloopMod = await import("memeloop");
    (memeloopMod.browse as any).mockImplementationOnce(({ onServiceUp }: any) => {
      onServiceUp({ name: "svc", type: "memeloop" });
    });

    await runCli(["start", "--port", "38472", "--data-dir", "/tmp"]);
  });

  it("start covers cloudUrl && nodeSecret registration path", async () => {
    state.config = {
      name: "node-a",
      providers: [],
      tools: { allowlist: [], blocklist: [] },
      cloudUrl: "https://cloud.example",
      nodeSecret: "sec-x",
      im: { channels: [] },
    };

    process.env.NODE_ENV = "test"; // 避免 mdns 分支 + 真实网络逻辑
    await runCli(["start", "--port", "38472", "--data-dir", "/tmp"]);

    // CloudClient mocked: getJwt/registerNode/heartbeat 不需要断言太细，关键是分支进入不会挂。
    expect(setIntervalSpy).toHaveBeenCalled();
  });

  it("start uses challenge auth when nodeSecret is absent", async () => {
    state.config = {
      name: "node-a",
      providers: [],
      tools: { allowlist: [], blocklist: [] },
      cloudUrl: "https://cloud.example",
      im: { channels: [] },
    };
    process.env.NODE_ENV = "test";
    await runCli(["start", "--port", "38472", "--data-dir", "/tmp"]);
    expect(state.cloudClient.getJwtByChallenge).toHaveBeenCalled();
    expect(state.cloudClient.getJwt).not.toHaveBeenCalled();
  });

  it("start wires notifyAskQuestion passthrough for IM channels", async () => {
    const telegramMod = await import("../im/telegramAdapter.js");
    const sendTelegramTextMessage = telegramMod.sendTelegramTextMessage as any;

    const getConversationMeta = vi
      .fn()
      .mockResolvedValueOnce({}) // no src => early return
      .mockResolvedValueOnce({ sourceChannel: { channelId: "missing", imUserId: "u-x" } }) // no ch => early return
      .mockResolvedValueOnce({ sourceChannel: { channelId: "tg1", imUserId: "u-tg" } }) // telegram channel => send
      .mockResolvedValueOnce({
        sourceChannel: { channelId: "d1", imUserId: "u-discord" },
      }); // discord channel => no send but setBinding when binding exists

    imGetBindingMock
      .mockResolvedValueOnce(undefined) // tg1: no binding
      .mockResolvedValueOnce({ imUserId: "u-discord", pendingQuestionId: "old" }); // d1: truthy
    imSetBindingMock.mockResolvedValueOnce(undefined);

    state.config = {
      name: "node-a",
      providers: [],
      tools: { allowlist: [], blocklist: [] },
      im: {
        channels: [
          { channelId: "tg1", platform: "telegram", botToken: "bt1" },
          { channelId: "d1", platform: "discord", botToken: "bt2" },
        ],
      },
    };

    process.env.NODE_ENV = "test";

    state.createNodeRuntime.mockReset().mockImplementationOnce((args: any) => {
      return {
        runtime: { __notifyAskQuestion: args.builtinToolContext.notifyAskQuestion },
        storage: { getConversationMeta },
        toolRegistry: {},
        wikiManager: undefined,
        agentDefinitions: [],
        fileBaseDirResolved: "/tmp",
        refreshWikiAgentDefinitions: undefined,
      };
    });

    state.startNodeServerWithMdns.mockImplementationOnce(async ({ rpcContext }: any) => {
      // Call 4 times to cover:
      // - no src
      // - src but no channel
      // - telegram channel with falsy binding
      // - non-telegram channel with truthy binding
      rpcContext.runtime.__notifyAskQuestion({ questionId: "q1", question: "Q1", conversationId: "c1" });
      await new Promise((r) => setImmediate(r));
      rpcContext.runtime.__notifyAskQuestion({ questionId: "q2", question: "Q2", conversationId: "c2" });
      await new Promise((r) => setImmediate(r));
      rpcContext.runtime.__notifyAskQuestion({ questionId: "q3", question: "Hello", conversationId: "c3" });
      await new Promise((r) => setImmediate(r));
      rpcContext.runtime.__notifyAskQuestion({ questionId: "q4", question: "Q4", conversationId: "c4" });
      await new Promise((r) => setImmediate(r));

      expect(sendTelegramTextMessage).toHaveBeenCalledWith("bt1", "u-tg", "❓ Hello");
      expect(imSetBindingMock).toHaveBeenCalledWith(
        expect.objectContaining({ pendingQuestionId: "q4" }),
      );
    });

    await runCli(["start", "--port", "38472", "--data-dir", "/tmp"]);
  });
});

