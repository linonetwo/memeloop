#!/usr/bin/env node
/**
 * memeloop-node CLI: register, start, status.
 */

import { randomBytes } from "node:crypto";

import { Command } from "commander";

import type { ImWebhookHandler } from "memeloop";
import { IMChannelManager } from "memeloop";

import { loadConfig, saveConfig, getDefaultConfigPath } from "./config.js";
import { createLanPinWsAuth } from "./auth/wsAuth.js";

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
  .action(async (opts: { otp?: string; config: string; cloudUrl?: string }) => {
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
    try {
      const result = await client.registerWithOtp(opts.otp);
      config.nodeId = result.nodeId;
      config.nodeSecret = result.nodeSecret;
      config.cloudUrl = cloudUrl;
      saveConfig(config, opts.config);
      console.log("Registered. nodeId:", result.nodeId);
    } catch (e) {
      console.error("Register failed:", e);
      process.exit(1);
    }
  });

program
  .command("start")
  .description("Start the node (WS server, runtime, mDNS)")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .option("-p, --port <number>", "WS/HTTP port", "38472")
  .option("-d, --data-dir <path>", "Data directory for SQLite", process.cwd())
  .action(async (opts: { config: string; port: string; dataDir: string }) => {
    const config = loadConfig(opts.config);
    const pathMod = await import("node:path");
    const dataDir = pathMod.resolve(opts.dataDir);
    const { createNodeRuntime } = await import("./runtime/index.js");
    const { TerminalSessionManager } = await import("./terminal/index.js");
    const { startNodeServerWithMdns, PeerConnectionManager } = await import("./network/index.js");
    const terminalManager = new TerminalSessionManager();
    const wikiBasePath = config.wikiPath ? pathMod.resolve(config.wikiPath) : undefined;
    const nodeId =
      config.nodeId ?? "memeloop-node-" + randomBytes(6).toString("base64url").replace(/=/g, "");
    const peerConnectionManager = new PeerConnectionManager({
      localNodeId: nodeId,
      handshakeCredential: config.auth?.ws?.mode === "lan-pin" ? config.auth?.ws?.pin ?? "" : "",
    });
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
      });
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
    });
    if (config.cloudUrl && config.nodeSecret) {
      const { CloudClient, buildRegistrationPayload } = await import("./auth/index.js");
      const { ConnectivityManager } = await import("memeloop");
      const client = new CloudClient(config.cloudUrl);
      const jwtResult = await client.getJwt(nodeId, config.nodeSecret);
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
  .action((opts: { config: string }) => {
    const config = loadConfig(opts.config);
    console.log("Config path:", opts.config);
    console.log("nodeSecret:", config.nodeSecret ? "***" : "(not set)");
    console.log("name:", config.name ?? "(default)");
    console.log("providers:", config.providers?.length ?? 0);
    console.log("wikiPath:", config.wikiPath ?? "(none)");
    console.log("tools allowlist:", config.tools?.allowlist?.length ?? 0);
    console.log("tools blocklist:", config.tools?.blocklist?.length ?? 0);
  });

program.parse();
