import { createHash } from "node:crypto";

import type { IIMAdapter, ImInboundMessage, ImWebhookContext } from "memeloop";

import {
  decryptWecomEncryptPayload,
  extractEncryptCDATA,
  looksLikeWecomEncryptedXml,
  parseWecomInboundFromXml,
  verifyWecomPostMsgSignature,
} from "./wecomCrypto.js";

export type WecomUrlVerifyQuery = {
  msgSignature: string;
  timestamp: string;
  nonce: string;
  echostr: string;
};

/** 企业微信：回调 URL GET 校验（token + timestamp + nonce 字典序 SHA1）。 */
export function verifyWecomUrl(
  token: string | undefined,
  q: WecomUrlVerifyQuery,
): string | null {
  if (!token?.trim()) {
    return null;
  }
  const arr = [token.trim(), q.timestamp, q.nonce].sort().join("");
  const hash = createHash("sha1").update(arr, "utf8").digest("hex");
  if (hash !== q.msgSignature) {
    return null;
  }
  return q.echostr;
}

function parseWecomJsonBody(body: Buffer): ImInboundMessage | null {
  let json: {
    FromUserName?: string;
    Text?: string;
    Content?: string;
    MsgType?: string;
  };
  try {
    json = JSON.parse(body.toString("utf8")) as typeof json;
  } catch {
    return null;
  }
  const text =
    typeof json.Text === "string"
      ? json.Text
      : typeof json.Content === "string"
        ? json.Content
        : "";
  const from = typeof json.FromUserName === "string" ? json.FromUserName : "";
  if (!text.trim() || !from) {
    return null;
  }
  return {
    channelId: "",
    platform: "wecom",
    imUserId: from,
    text: text.trim(),
    raw: json,
  };
}

export class WecomIMAdapter implements IIMAdapter {
  readonly platform = "wecom" as const;

  constructor(
    private readonly token?: string,
    private readonly encodingAesKey?: string,
    private readonly corpId?: string,
  ) {}

  verify(ctx: ImWebhookContext): boolean {
    const raw = ctx.body.toString("utf8");
    if (!raw.trim()) {
      return false;
    }
    if (this.encodingAesKey?.trim() && looksLikeWecomEncryptedXml(raw)) {
      const q = ctx.query ?? {};
      const msgSig = q.msg_signature ?? "";
      const ts = q.timestamp ?? "";
      const nonce = q.nonce ?? "";
      const encrypt = extractEncryptCDATA(raw);
      if (!encrypt || !verifyWecomPostMsgSignature(this.token, ts, nonce, encrypt, msgSig)) {
        return false;
      }
      const xml = decryptWecomEncryptPayload(this.encodingAesKey, encrypt, this.corpId);
      return Boolean(xml);
    }
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  }

  parse(channelId: string, ctx: ImWebhookContext): ImInboundMessage | null {
    const raw = ctx.body.toString("utf8");
    if (this.encodingAesKey?.trim() && looksLikeWecomEncryptedXml(raw)) {
      const q = ctx.query ?? {};
      const encrypt = extractEncryptCDATA(raw);
      if (
        !encrypt ||
        !verifyWecomPostMsgSignature(this.token, q.timestamp ?? "", q.nonce ?? "", encrypt, q.msg_signature ?? "")
      ) {
        return null;
      }
      const inner = decryptWecomEncryptPayload(this.encodingAesKey, encrypt, this.corpId);
      if (!inner) {
        return null;
      }
      const msg = parseWecomInboundFromXml(inner, channelId);
      return msg;
    }
    const msg = parseWecomJsonBody(ctx.body);
    if (!msg) {
      return null;
    }
    return { ...msg, channelId };
  }
}
