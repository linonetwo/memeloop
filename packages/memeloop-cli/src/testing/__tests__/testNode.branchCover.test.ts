import { beforeEach, describe, expect, it, vi } from "vitest";

import { startTestNode } from "../testNode.js";

const createNodeRuntimeMock = vi.fn();
const startNodeServerWithMdnsMock = vi.fn();

vi.mock("../../runtime/index.js", () => ({
  createNodeRuntime: (...args: any[]) => createNodeRuntimeMock(...args),
}));

vi.mock("../../network/index.js", () => ({
  startNodeServerWithMdns: (...args: any[]) => startNodeServerWithMdnsMock(...args),
}));

describe("startTestNode branch coverage", () => {
  beforeEach(() => {
    createNodeRuntimeMock.mockReset();
    startNodeServerWithMdnsMock.mockReset();

    createNodeRuntimeMock.mockReturnValue({
      runtime: {},
      storage: { getMessages: vi.fn().mockResolvedValue([]) },
      wikiManager: undefined,
      toolRegistry: { registerTool: vi.fn() },
      agentDefinitions: [],
      fileBaseDirResolved: "/tmp",
    });
  });

  it("uses provided dataDir and wsAuth (happy path)", async () => {
    startNodeServerWithMdnsMock.mockResolvedValue({
      address: () => ({ port: 12345 }),
    });

    const node = await startTestNode("node-1", {
      port: 9999,
      dataDir: "/tmp/memeloop-test-node-1",
      wsAuth: { mode: "lan-pin", pin: "123456" } as any,
    });

    expect(node.port).toBe(12345);
    expect(createNodeRuntimeMock).toHaveBeenCalled();
    expect(startNodeServerWithMdnsMock).toHaveBeenCalledWith(
      expect.objectContaining({ wsAuth: { mode: "lan-pin", pin: "123456" }, port: 9999 }),
    );

    node.registerTool("x", async () => ({ ok: true }));
  });

  it("throws when server.address() is invalid", async () => {
    startNodeServerWithMdnsMock.mockResolvedValue({
      address: () => null,
    });

    await expect(startTestNode("node-2")).rejects.toThrow(/Failed to get server address/);
  });
});

