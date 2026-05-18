import type { IIMAdapter, ImInboundMessage, ImWebhookContext } from "memeloop";

export class TelegramIMAdapter implements IIMAdapter {
  readonly platform = "telegram" as const;

  constructor(private readonly webhookSecret?: string) {}

  verify(ctx: ImWebhookContext): boolean {
    if (!this.webhookSecret?.trim()) {
      return true;
    }
    const h = ctx.headers["x-telegram-bot-api-secret-token"];
    const v = Array.isArray(h) ? h[0] : h;
    return v === this.webhookSecret;
  }

  parse(channelId: string, ctx: ImWebhookContext): ImInboundMessage | null {
    let data: unknown;
    try {
      data = JSON.parse(ctx.body.toString("utf8")) as unknown;
    } catch {
      return null;
    }
    const root = data as {
      message?: { text?: string; chat?: { id?: number | string } };
    };
    const msg = root.message;
    if (!msg?.chat?.id) {
      return null;
    }
    const text = typeof msg.text === "string" ? msg.text : "";
    return {
      channelId,
      platform: "telegram",
      imUserId: String(msg.chat.id),
      text,
      raw: data,
    };
  }
}

export async function sendTelegramTextMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  }).catch(() => {
    /* 出站失败不阻塞 webhook 200 */
  });
}
