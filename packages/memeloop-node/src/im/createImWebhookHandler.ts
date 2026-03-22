import type { ImWebhookHandler, MemeLoopRuntime } from "memeloop";
import { IMChannelManager } from "memeloop";

import type { ImChannelYaml } from "../config.js";
import {
  parseDiscordInteraction,
  sendDiscordFollowup,
  verifyDiscordInteraction,
} from "./discordAdapter.js";
import { handleLarkWebhook } from "./larkAdapter.js";
import { TelegramIMAdapter, sendTelegramTextMessage } from "./telegramAdapter.js";
import { verifyWecomUrl, WecomIMAdapter } from "./wecomAdapter.js";

export interface CreateImWebhookHandlerOptions {
  channels: ImChannelYaml[];
  manager: IMChannelManager;
  runtime: MemeLoopRuntime;
}

function parseQueryString(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const part of qs.split("&")) {
    const i = part.indexOf("=");
    if (i < 0) {
      out[decodeURIComponent(part)] = "";
    } else {
      out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
    }
  }
  return out;
}

type ImWebhookArgs = Parameters<ImWebhookHandler>[0] & { method?: string; queryString?: string };

export function createImWebhookHandler(options: CreateImWebhookHandlerOptions): ImWebhookHandler {
  const { channels, manager, runtime } = options;

  const driver = {
    createAgent: runtime.createAgent.bind(runtime),
    sendMessage: runtime.sendMessage.bind(runtime),
  };

  const handler = async ({ req, res, channelId, body, method = "POST", queryString = "" }: ImWebhookArgs) => {
    const cfg = channels.find((c) => c.channelId === channelId);
    if (!cfg) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("unknown channel");
      return;
    }

    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    const query = parseQueryString(queryString);
    const ctx = { headers, body, query };

    if (cfg.platform === "wecom" && method === "GET") {
      const echostr = verifyWecomUrl(cfg.wecomToken, {
        msgSignature: query.msg_signature ?? "",
        timestamp: query.timestamp ?? "",
        nonce: query.nonce ?? "",
        echostr: query.echostr ?? "",
      });
      if (echostr == null) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("verify failed");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(echostr);
      return;
    }

    if (cfg.platform === "telegram") {
      const adapter = new TelegramIMAdapter(cfg.webhookSecret);
      if (!adapter.verify(ctx)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("unauthorized");
        return;
      }
      const inbound = adapter.parse(channelId, ctx);
      if (!inbound || !inbound.text.trim()) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      try {
        await manager.dispatchInbound(inbound, driver, {
          defaultDefinitionId: cfg.defaultDefinitionId ?? "memeloop:general-assistant",
        });
        await sendTelegramTextMessage(cfg.botToken, inbound.imUserId, "已收到，正在处理…");
      } catch (e) {
        await sendTelegramTextMessage(
          cfg.botToken,
          inbound.imUserId,
          `处理失败：${e instanceof Error ? e.message : String(e)}`,
        );
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (cfg.platform === "discord") {
      if (!verifyDiscordInteraction(cfg.discordPublicKey, ctx)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("unauthorized");
        return;
      }
      const parsed = parseDiscordInteraction(channelId, ctx);
      if (parsed.kind === "ping") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: 1 }));
        return;
      }
      if (parsed.kind === "application_command") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: 5 }));
        const defId = cfg.defaultDefinitionId ?? "memeloop:general-assistant";
        void (async () => {
          try {
            await manager.dispatchInbound(
              {
                channelId,
                platform: "discord",
                imUserId: parsed.userId,
                text: parsed.text,
                raw: parsed.raw,
              },
              driver,
              { defaultDefinitionId: defId },
            );
            await sendDiscordFollowup(parsed.applicationId, parsed.token, "已收到，正在处理…");
          } catch (e) {
            await sendDiscordFollowup(
              parsed.applicationId,
              parsed.token,
              `处理失败：${e instanceof Error ? e.message : String(e)}`,
            );
          }
        })();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: 1 }));
      return;
    }

    if (cfg.platform === "lark") {
      const larkRes = handleLarkWebhook(channelId, cfg.larkVerificationToken, cfg.larkEncryptKey, ctx);
      if (larkRes.kind === "url_verification") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ challenge: larkRes.challenge }));
        return;
      }
      if (larkRes.kind === "inbound") {
        try {
          await manager.dispatchInbound(larkRes.message, driver, {
            defaultDefinitionId: cfg.defaultDefinitionId ?? "memeloop:general-assistant",
          });
        } catch {
          /* 仍返回 200 避免飞书重试风暴 */
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({}));
      return;
    }

    if (cfg.platform === "wecom") {
      const adapter = new WecomIMAdapter(cfg.wecomToken, cfg.wecomEncodingAesKey, cfg.wecomCorpId);
      if (!adapter.verify(ctx)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("unauthorized");
        return;
      }
      const inbound = adapter.parse(channelId, ctx);
      if (!inbound || !inbound.text.trim()) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("success");
        return;
      }
      try {
        await manager.dispatchInbound(inbound, driver, {
          defaultDefinitionId: cfg.defaultDefinitionId ?? "memeloop:general-assistant",
        });
      } catch {
        /* ignore */
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
      return;
    }

    res.writeHead(501, { "Content-Type": "text/plain" });
    res.end("platform not supported");
  };

  return handler as ImWebhookHandler;
}
