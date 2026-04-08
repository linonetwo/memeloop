import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { IToolRegistry } from "memeloop";

// Mock child_process for demo server spawning
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, callback: () => void) => {
      if (event === "spawn") {
        setTimeout(() => callback(), 10);
      }
    }),
    kill: vi.fn(),
  })),
}));

// Mock net for port checking
vi.mock("node:net", () => ({
  createConnection: vi.fn(() => ({
    on: vi.fn((event: string, callback: () => void) => {
      if (event === "connect") {
        setTimeout(() => callback(), 50);
      }
    }),
    destroy: vi.fn(),
  })),
}));

import { registerDemoTools } from "../demo";

class FakeRegistry implements Pick<IToolRegistry, "registerTool"> {
  tools = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  registerTool(id: string, impl: (args: Record<string, unknown>) => Promise<unknown>): void {
    this.tools.set(id, impl);
  }
}

describe("demo tools", () => {
  let registry: FakeRegistry;

  beforeEach(() => {
    registry = new FakeRegistry();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers demo.start, demo.stop, demo.screenshot tools", () => {
    registerDemoTools(registry as IToolRegistry);
    expect(registry.tools.has("demo.start")).toBe(true);
    expect(registry.tools.has("demo.stop")).toBe(true);
    expect(registry.tools.has("demo.screenshot")).toBe(true);
  });

  it("demo.start validates workingDir parameter", async () => {
    registerDemoTools(registry as IToolRegistry);
    const tool = registry.tools.get("demo.start")!;
    const res = (await tool({})) as Record<string, unknown>;
    expect(res.error).toContain("workingDir");
  });

  it("demo.start validates command parameter", async () => {
    registerDemoTools(registry as IToolRegistry);
    const tool = registry.tools.get("demo.start")!;
    const res = (await tool({ workingDir: "/tmp" })) as Record<string, unknown>;
    expect(res.error).toContain("command");
  });

  it("demo.start spawns server successfully", async () => {
    registerDemoTools(registry as IToolRegistry);
    const tool = registry.tools.get("demo.start")!;
    const res = (await tool({
      workingDir: "/tmp/test-app",
      command: "npm run dev",
    })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.serverId).toBeDefined();
    expect(res.url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("demo.start detects port from command", async () => {
    registerDemoTools(registry as IToolRegistry);
    const tool = registry.tools.get("demo.start")!;
    const res = (await tool({
      workingDir: "/tmp/test-app",
      command: "npm run dev -- --port 4000",
    })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.url).toBe("http://localhost:4000");
  });

  it("demo.stop validates serverId parameter", async () => {
    registerDemoTools(registry as IToolRegistry);
    const tool = registry.tools.get("demo.stop")!;
    const res = (await tool({})) as Record<string, unknown>;
    expect(res.error).toContain("serverId");
  });

  it("demo.stop handles non-existent serverId", async () => {
    registerDemoTools(registry as IToolRegistry);
    const tool = registry.tools.get("demo.stop")!;
    const res = (await tool({ serverId: "non-existent" })) as Record<string, unknown>;
    expect(res.error).toContain("not found");
  });

  it("demo.screenshot validates workingDir parameter", async () => {
    registerDemoTools(registry as IToolRegistry);
    const tool = registry.tools.get("demo.screenshot")!;
    const res = (await tool({})) as Record<string, unknown>;
    expect(res.error).toContain("workingDir");
  });

  it("demo.screenshot validates command parameter", async () => {
    registerDemoTools(registry as IToolRegistry);
    const tool = registry.tools.get("demo.screenshot")!;
    const res = (await tool({ workingDir: "/tmp" })) as Record<string, unknown>;
    expect(res.error).toContain("command");
  });
});
