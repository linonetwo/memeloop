/* eslint-disable @typescript-eslint/no-deprecated */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchLLMProvider } from "../fetchProvider.js";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

describe("createFetchLLMProvider", () => {
  it("returns AsyncIterable for stream:true and text/event-stream", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + "data: [DONE]\n\n";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new TextEncoder().encode(sse), {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      }),
    ) as typeof fetch;

    const provider = createFetchLLMProvider({
      name: "openai-like",
      baseUrl: "http://localhost:9999",
      apiKey: "sk-test",
    });
    const raw = await provider.chat({ stream: true, messages: [] });
    expect(raw).toBeTruthy();
    expect(typeof (raw as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");
    const chunks: unknown[] = [];
    for await (const c of raw as AsyncIterable<unknown>) {
      chunks.push(c);
    }
    expect(chunks[0]).toMatchObject({ choices: [{ delta: { content: "hi" } }] });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:9999/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("returns parsed JSON for non-streaming when no assistant content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "cmpl-1", choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    const provider = createFetchLLMProvider({
      name: "openai-like",
      baseUrl: "http://api",
      apiKey: "",
    });
    const raw = await provider.chat({ stream: false, messages: [] });
    expect(raw).toEqual({ id: "cmpl-1", choices: [] });
  });

  it("returns assistant text string for non-streaming OpenAI-shaped completion", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cmpl-2",
          choices: [{ message: { role: "assistant", content: "hello from model" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const provider = createFetchLLMProvider({
      name: "openai-like",
      baseUrl: "http://api",
      apiKey: "",
    });
    const raw = await provider.chat({ stream: false, messages: [] });
    expect(raw).toBe("hello from model");
  });

  it("maps modelId to model for OpenAI-compatible providers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cmpl-3",
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const provider = createFetchLLMProvider({
      name: "siliconflow",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "sk-test",
    });

    await provider.chat({
      modelId: "siliconflow/Qwen/Qwen3.5-397B-A17B",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.siliconflow.cn/v1/chat/completions",
      expect.objectContaining({
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
          model: "Qwen/Qwen3.5-397B-A17B",
        }),
      }),
    );
  });

  it("accepts host-root, /v1 base URL, and full endpoint URL forms", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: "cmpl-4",
            choices: [{ message: { role: "assistant", content: "ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    const request = { model: "zai-org/GLM-4.6", messages: [{ role: "user", content: "hi" }] };

    await createFetchLLMProvider({
      name: "siliconflow",
      baseUrl: "https://api.siliconflow.cn",
      apiKey: "sk-test",
    }).chat(request);
    await createFetchLLMProvider({
      name: "siliconflow",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "sk-test",
    }).chat(request);
    await createFetchLLMProvider({
      name: "siliconflow",
      baseUrl: "https://api.siliconflow.cn/v1/chat/completions",
      apiKey: "sk-test",
    }).chat(request);

    const urls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0],
    );
    expect(urls).toEqual([
      "https://api.siliconflow.cn/v1/chat/completions",
      "https://api.siliconflow.cn/v1/chat/completions",
      "https://api.siliconflow.cn/v1/chat/completions",
    ]);
  });

  it("covers SSE blocks without data: lines and non-JSON data payload", async () => {
    const sse =
      "\n\n" +
      "data: not-json\n\n" +
      'data: {"choices":[{"delta":{"content":"hi2"}}]}\n\n' +
      "data: [DONE]\n\n";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new TextEncoder().encode(sse), {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      }),
    ) as typeof fetch;

    const provider = createFetchLLMProvider({
      name: "openai-like",
      baseUrl: "http://localhost:9999",
      apiKey: "",
    });

    const raw = (await provider.chat({ stream: true, messages: [] })) as AsyncIterable<unknown>;
    const chunks: unknown[] = [];
    for await (const c of raw) {
      chunks.push(c);
    }

    expect(chunks).toContain("not-json");
    expect(chunks.some((c) => (c as any)?.choices?.[0]?.delta?.content === "hi2")).toBe(true);
  });

  it("throws when fetch returns non-ok HTTP status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("bad", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    ) as typeof fetch;

    const provider = createFetchLLMProvider({
      name: "openai-like",
      baseUrl: "http://api",
      apiKey: "",
    });

    await expect(provider.chat({ stream: false, messages: [] })).rejects.toThrow(
      "LLM request failed: 500 bad",
    );
  });
});
