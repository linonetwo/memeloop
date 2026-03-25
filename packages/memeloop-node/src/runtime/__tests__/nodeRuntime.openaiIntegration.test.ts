import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createNodeRuntime } from "../nodeRuntime.js";
import { startMockOpenAI } from "../../testing/mockOpenAI.js";

describe("createNodeRuntime + mock OpenAI HTTP", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  it("completes a user turn with JSON chat/completions (dialogue)", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memeloop-oai-"));
    dirs.push(dataDir);
    const mock = await startMockOpenAI({ replyText: "mock says hello" });
    try {
      const { runtime, storage } = createNodeRuntime({
        config: {
          providers: [{ name: "oai", baseUrl: mock.baseUrl, apiKey: "k" }],
        },
        dataDir,
      });
      const { conversationId } = await runtime.createAgent({ definitionId: "memeloop:general-assistant" });

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 20_000);
        const off = runtime.subscribeToUpdates(conversationId, (u) => {
          if ((u as { type?: string }).type === "agent-done") {
            clearTimeout(t);
            off();
            resolve();
          }
          if ((u as { type?: string }).type === "agent-error") {
            clearTimeout(t);
            off();
            reject(new Error((u as { error?: string }).error ?? "agent-error"));
          }
        });
        void runtime.sendMessage({ conversationId, message: "hi" });
      });

      const msgs = await storage.getMessages(conversationId, { mode: "full-content" });
      expect(msgs.some((m) => m.role === "user")).toBe(true);
      expect(msgs.some((m) => m.role === "assistant" && m.content.includes("mock says hello"))).toBe(true);
    } finally {
      await mock.stop();
    }
  });

  it("runs a tool round-trip: first completion requests tool, second completes", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memeloop-oai-tool-"));
    dirs.push(dataDir);
    const mock = await startMockOpenAI({
      replySequence: [
        '<tool_use name="e2eEcho">{"text":"openai-mock"}</tool_use>',
        "final line after tool execution",
      ],
    });
    try {
      const { runtime, storage, toolRegistry } = createNodeRuntime({
        config: {
          providers: [{ name: "oai", baseUrl: mock.baseUrl, apiKey: "k" }],
          tools: { allowlist: ["e2eEcho"] },
        },
        dataDir,
      });
      toolRegistry.registerTool("e2eEcho", async (args: Record<string, unknown>) => ({
        echoed: String(args.text ?? ""),
      }));

      const { conversationId } = await runtime.createAgent({ definitionId: "memeloop:general-assistant" });

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 25_000);
        const off = runtime.subscribeToUpdates(conversationId, (u) => {
          if ((u as { type?: string }).type === "agent-done") {
            clearTimeout(t);
            off();
            resolve();
          }
          if ((u as { type?: string }).type === "agent-error") {
            clearTimeout(t);
            off();
            reject(new Error((u as { error?: string }).error ?? "agent-error"));
          }
        });
        void runtime.sendMessage({ conversationId, message: "use echo" });
      });

      const msgs = await storage.getMessages(conversationId, { mode: "full-content" });
      expect(msgs.some((m) => m.role === "tool")).toBe(true);
      const toolMsg = msgs.find((m) => m.role === "tool");
      expect(toolMsg?.content).toContain("e2eEcho");
      expect(msgs.some((m) => m.role === "assistant" && m.content.includes("final line after tool"))).toBe(
        true,
      );
    } finally {
      await mock.stop();
    }
  });

  it("registers node environment tools in memeloop-node runtime", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memeloop-node-tools-"));
    dirs.push(dataDir);
    const { toolRegistry } = createNodeRuntime({
      config: { providers: [] },
      dataDir,
    });
    const tools = toolRegistry.listTools();
    expect(tools).toContain("file.read");
    expect(tools).toContain("git");
    expect(tools).toContain("webFetch");
    expect(tools).toContain("todo");
    expect(tools).toContain("summary");
  });
});
