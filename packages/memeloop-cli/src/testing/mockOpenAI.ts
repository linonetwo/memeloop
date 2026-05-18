import http from "node:http";

export interface MockOpenAIOptions {
  /** Single assistant message content (default when `replySequence` is omitted). */
  replyText?: string;
  /**
   * One JSON completion per POST to `/v1/chat/completions`, in order.
   * After the last entry, further requests repeat the last reply.
   */
  replySequence?: string[];
}

export interface StartedMockOpenAI {
  server: http.Server;
  port: number;
  baseUrl: string;
  stop(): Promise<void>;
}

function normalizeReplies(options: MockOpenAIOptions): string[] {
  if (options.replySequence?.length) {
    return options.replySequence;
  }
  const t = options.replyText ?? "ok";
  return [t];
}

export async function startMockOpenAI(options: MockOpenAIOptions): Promise<StartedMockOpenAI> {
  const replies = normalizeReplies(options);
  let callIndex = 0;
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
      let body = "";
      req.on("data", (d) => {
        body += d.toString();
      });
      req.on("end", () => {
        void body;
        const i = Math.min(callIndex, replies.length - 1);
        callIndex += 1;
        const content = replies[i] ?? "";
        const payload = {
          id: "chatcmpl_mock",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "mock-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start mock OpenAI server");
  }

  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    server,
    port,
    baseUrl,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

