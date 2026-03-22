import type { ILLMProvider } from "memeloop";
import type { ProviderEntry } from "../config.js";

async function* parseOpenAiSseStream(res: Response): AsyncGenerator<unknown, void, unknown> {
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) {
          continue;
        }
        const payload = dataLine.slice(5).trim();
        if (payload === "[DONE]") {
          return;
        }
        try {
          yield JSON.parse(payload) as unknown;
        } catch {
          yield payload;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * OpenAI 兼容 HTTP LLM：`stream: true` 且 `text/event-stream` 时返回 AsyncIterable（SSE）；
 * 非流式时在 `choices[0].message.content` 为字符串时返回该正文（供 TaskAgent 解析 tool XML），否则返回解析后的 JSON。
 */
export function createFetchLLMProvider(entry: ProviderEntry): ILLMProvider {
  const { name, baseUrl, apiKey } = entry;
  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";

  return {
    name,
    async chat(request: unknown): Promise<unknown> {
      const body =
        typeof request === "object" && request !== null ? { ...(request as object) } : { messages: [] };
      const streamRequested = Boolean((body as { stream?: boolean }).stream);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM request failed: ${res.status} ${text}`);
      }
      const ct = res.headers.get("content-type") ?? "";
      if (streamRequested && ct.includes("text/event-stream")) {
        return parseOpenAiSseStream(res);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text === "string") {
        return text;
      }
      return json as unknown;
    },
  };
}
