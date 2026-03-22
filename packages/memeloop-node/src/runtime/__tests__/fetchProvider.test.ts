import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchLLMProvider } from "../fetchProvider.js";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

describe("createFetchLLMProvider", () => {
  it("returns AsyncIterable for stream:true and text/event-stream", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + "data: [DONE]\n\n";
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
});
