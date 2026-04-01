#!/usr/bin/env node
/**
 * memeloop-node CLI: register, start, status.
 */

import { Command } from "commander";

import type { ImWebhookHandler } from "memeloop";
import { IMChannelManager } from "memeloop";

import { loadConfig, saveConfig, getDefaultConfigPath } from "./config";
import { createLanPinWsAuth } from "./auth/wsAuth.js";
import { getDefaultKeypairPath, loadOrCreateNodeKeypair } from "./auth/keypair.js";
import { nodeKeypairToNoiseStaticKeyPair } from "./auth/noiseKeypair.js";

const program = new Command();

program
  .name("memeloop")
  .description("MemeLoop CLI compute node")
  .version("0.0.0");

program
  .command("register")
  .description("Register this node with Cloud using OTP")
  .option("-o, --otp <code>", "6-digit OTP from Cloud")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .option("-u, --cloud-url <url>", "Cloud API base URL")
  .option("-k, --keypair <path>", "Node keypair path", getDefaultKeypairPath())
  .action(async (opts: { otp?: string; config: string; cloudUrl?: string; keypair: string }) => {
    if (!opts.otp) {
      console.error("Usage: memeloop register --otp <6-digit-code> [--cloud-url <url>]");
      process.exit(1);
    }
    const config = loadConfig(opts.config);
    const cloudUrl = opts.cloudUrl ?? config.cloudUrl;
    if (!cloudUrl) {
      console.error("Set cloud URL: --cloud-url <url> or cloudUrl in config.");
      process.exit(1);
    }
    const { CloudClient } = await import("./auth/index.js");
    const client = new CloudClient(cloudUrl);
    const keypair = loadOrCreateNodeKeypair(opts.keypair);
    try {
      const result = await client.registerWithOtp(opts.otp, {
        x25519PublicKey: keypair.x25519PublicKey,
        ed25519PublicKey: keypair.ed25519PublicKey,
      });
      config.nodeId = result.nodeId || keypair.nodeId;
      if (result.nodeSecret) config.nodeSecret = result.nodeSecret;
      config.cloudUrl = cloudUrl;
      saveConfig(config, opts.config);
      console.log("Registered. nodeId:", config.nodeId);
    } catch (e) {
      console.error("Register failed:", e);
      process.exit(1);
    }
  });

program
  .command("start")
  .description("Start the node (WS server, runtime, mDNS)")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .option("-k, --keypair <path>", "Node keypair path", getDefaultKeypairPath())
  .option("-p, --port <number>", "WS/HTTP port", "38472")
  .option("-d, --data-dir <path>", "Data directory for SQLite", process.cwd())
  .action(async (opts: { config: string; keypair: string; port: string; dataDir: string }) => {
    const config = loadConfig(opts.config);
    const pathMod = await import("node:path");
    const dataDir = pathMod.resolve(opts.dataDir);
    const { createNodeRuntime } = await import("./runtime/index.js");
    const { TerminalSessionManager } = await import("./terminal/index.js");
    const { startNodeServerWithMdns, PeerConnectionManager } = await import("./network/index.js");
    const terminalManager = new TerminalSessionManager();
    const wikiBasePath = config.wikiPath ? pathMod.resolve(config.wikiPath) : undefined;
    const keypair = loadOrCreateNodeKeypair(opts.keypair);
    const nodeId = config.nodeId ?? keypair.nodeId;
    const peerConnectionManager = new PeerConnectionManager({
      localNodeId: nodeId,
      handshakeCredential: config.auth?.ws?.mode === "lan-pin" ? config.auth?.ws?.pin ?? "" : "",
      noiseStaticKeyPair: nodeKeypairToNoiseStaticKeyPair(keypair),
    });
    // `askQuestion` needs an out-of-band notify channel (IM / UI). We wire this up after runtime is created.
    let notifyAskQuestionImpl:
      | ((payload: {
        questionId: string;
        question: string;
        conversationId?: string;
        inputType?: "single-select" | "multi-select" | "text";
        options?: Array<{ label: string; description?: string }>;
        allowFreeform?: boolean;
      }) => void)
      | undefined;
    const {
      runtime,
      storage,
      toolRegistry,
      wikiManager,
      agentDefinitions,
      fileBaseDirResolved,
      refreshWikiAgentDefinitions,
    } = createNodeRuntime({
      config,
      dataDir,
      terminalManager,
      fileBaseDir: dataDir,
      wikiBasePath,
      peerConnectionManager,
      localNodeId: nodeId,
      wikiAgentDefinitionWikiIds: config.wikiAgentDefinitionWikiIds,
      builtinToolContext: {
        notifyAskQuestion: (p) => notifyAskQuestionImpl?.(p),
      },
    });
    if (wikiBasePath && refreshWikiAgentDefinitions) {
      const fs = await import("node:fs");
      let debounce: ReturnType<typeof setTimeout> | undefined;
      const schedule = (): void => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          refreshWikiAgentDefinitions!().catch((e) => console.warn("[memeloop-node] wiki defs refresh:", e));
        }, 900);
      };
      try {
        fs.watch(wikiBasePath, { recursive: true }, schedule);
      } catch (e) {
        console.warn("[memeloop-node] fs.watch wikiPath failed:", e);
      }
    }
    const port = parseInt(opts.port, 10) || 38472;
    const mcpServers =
      config.mcpServers?.map((s) => ({ name: s.name, command: s.command, args: s.args })) ?? [];
    const wsAuth = createLanPinWsAuth(config, opts.config);
    const imChannels = config.im?.channels ?? [];
    const imManager = new IMChannelManager(storage);
    let imWebhookHandler: ImWebhookHandler | undefined;
    if (imChannels.length > 0) {
      const { createImWebhookHandler } = await import("./im/createImWebhookHandler.js");
      imWebhookHandler = createImWebhookHandler({
        channels: imChannels,
        manager: imManager,
        runtime,
        storage,
      });
      // Best-effort IM askQuestion passthrough: send question to the same IM user that owns the conversation.
      const { sendTelegramTextMessage } = await import("./im/telegramAdapter.js");
      notifyAskQuestionImpl = (payload) => {
        void (async () => {
          if (!payload.conversationId) return;
          const meta = await storage.getConversationMeta(payload.conversationId);
          const src = meta?.sourceChannel;
          if (!src) return;
          const ch = imChannels.find((c) => c.channelId === src.channelId);
          if (!ch) return;
          const binding = await imManager.getBinding(src.channelId, src.imUserId);
          if (binding) {
            await imManager.setBinding({ ...binding, pendingQuestionId: payload.questionId });
          }
          if (ch.platform === "telegram") {
            await sendTelegramTextMessage(
              ch.botToken,
              src.imUserId,
              `❓ ${payload.question}`,
            );
          }
        })().catch(() => {});
      };
    }
    await startNodeServerWithMdns({
      port,
      nodeId,
      rpcContext: {
        runtime,
        storage,
        toolRegistry,
        terminalManager,
        wikiManager,
        nodeId,
        mcpServers,
        imChannels,
        agentDefinitions,
        fileBaseDir: fileBaseDirResolved,
      },
      serviceName: config.name ?? "memeloop-node",
      wsAuth,
      imWebhookHandler,
      noise: { staticKeyPair: nodeKeypairToNoiseStaticKeyPair(keypair) },
    });
    // LAN zero-config discovery: browse _memeloop._tcp and auto-connect discovered peers.
    // Keep best-effort only; failures should not block node startup.
    if (process.env.NODE_ENV !== "test" && process.env.MEMELOOP_DISABLE_MDNS !== "1") {
      const { browse } = await import("memeloop");
      const { autoConnectDiscoveredPeer } = await import("./network/lanAutoConnect.js");
      browse({
        onServiceUp: (svc) => {
          void autoConnectDiscoveredPeer(svc, nodeId, peerConnectionManager);
        },
      });
    }
    if (config.cloudUrl) {
      const { CloudClient, buildRegistrationPayload } = await import("./auth/index.js");
      const { ConnectivityManager } = await import("memeloop");
      const client = new CloudClient(config.cloudUrl);
      const jwtResult = config.nodeSecret
        ? await client.getJwt(nodeId, config.nodeSecret)
        : await client.getJwtByChallenge(nodeId, keypair.ed25519PrivateKey);
      const connectivity = new ConnectivityManager(port);
      await connectivity.detectPublicIP();
      const payload = buildRegistrationPayload(nodeId, port, config.name, connectivity);
      await client.registerNode(payload, jwtResult.accessToken);
      setInterval(() => {
        client.heartbeat(nodeId, jwtResult.accessToken).catch(() => {});
      }, 60_000);
    }
    console.log("Node listening on port", port, "| Data dir:", dataDir);
    console.log("Providers:", config.providers?.length ?? 0, "| Wiki:", config.wikiPath ?? "(none)");
  });

const imCmd = new Command("im").description("IM Webhook 频道（/im/webhook/<channelId>）");

imCmd
  .command("add")
  .description("添加 IM channel 并写入 YAML")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .requiredOption("--platform <platform>", "telegram | discord | lark | wecom")
  .requiredOption("--token <token>", "Bot token（Telegram 等）")
  .option("--secret <secret>", "Webhook 校验 secret（如 Telegram secret_token）")
  .option("--definition <id>", "默认 Agent Definition", "memeloop:general-assistant")
  .option("--discord-public-key <hex>", "Discord Application Public Key（hex）")
  .action(
    async (opts: {
      config: string;
      platform: string;
      token: string;
      secret?: string;
      definition: string;
      discordPublicKey?: string;
    }) => {
      const { randomUUID } = await import("node:crypto");
      const cfg = loadConfig(opts.config);
      const platform = opts.platform.trim().toLowerCase();
      if (!["telegram", "discord", "lark", "wecom"].includes(platform)) {
        console.error("Unsupported platform:", platform);
        process.exit(1);
      }
      const channel = {
        channelId: randomUUID(),
        platform: platform as import("@memeloop/protocol").IMPlatformType,
        botToken: opts.token,
        webhookSecret: opts.secret,
        defaultDefinitionId: opts.definition,
        discordPublicKey: opts.discordPublicKey,
      };
      cfg.im = cfg.im ?? { channels: [] };
      cfg.im.channels = [...(cfg.im.channels ?? []), channel];
      saveConfig(cfg, opts.config);
      console.log("channelId:", channel.channelId);
      console.log("Direct webhook path: POST /im/webhook/" + channel.channelId);
    },
  );

imCmd
  .command("list")
  .description("列出 YAML 中的 IM channels")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .action((opts: { config: string }) => {
    const cfg = loadConfig(opts.config);
    console.log(JSON.stringify(cfg.im?.channels ?? [], null, 2));
  });

imCmd
  .command("remove")
  .description("按 channelId 删除")
  .argument("<channelId>", "Channel UUID")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .action((channelId: string, opts: { config: string }) => {
    const cfg = loadConfig(opts.config);
    cfg.im ??= { channels: [] };
    cfg.im.channels = (cfg.im.channels ?? []).filter((c) => c.channelId !== channelId);
    saveConfig(cfg, opts.config);
    console.log("removed", channelId);
  });

program.addCommand(imCmd);

program
  .command("status")
  .description("Show node status (config, connectivity)")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .option("-k, --keypair <path>", "Node keypair path", getDefaultKeypairPath())
  .action((opts: { config: string; keypair: string }) => {
    const config = loadConfig(opts.config);
    const keypair = loadOrCreateNodeKeypair(opts.keypair);
    console.log("Config path:", opts.config);
    console.log("Keypair path:", opts.keypair);
    console.log("nodeId:", config.nodeId ?? keypair.nodeId);
    console.log("nodeSecret:", config.nodeSecret ? "***" : "(not set)");
    console.log("name:", config.name ?? "(default)");
    console.log("providers:", config.providers?.length ?? 0);
    console.log("wikiPath:", config.wikiPath ?? "(none)");
    console.log("tools allowlist:", config.tools?.allowlist?.length ?? 0);
    console.log("tools blocklist:", config.tools?.blocklist?.length ?? 0);
  });

program.parse();
