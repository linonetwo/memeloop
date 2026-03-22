import { After, Given, Then, When } from "@cucumber/cucumber";

import type { NodeWorld } from "./world.js";

Given('a running memeloop node {string}', async function (this: NodeWorld, nodeId: string) {
  await this.startNode(nodeId);
});

Given(
  'a running memeloop node {string} with provider {string} pointing to the mock OpenAI server',
  async function (this: NodeWorld, nodeId: string, providerName: string) {
    if (!this.mockOpenAI) {
      throw new Error("Mock OpenAI server is not started");
    }
    await this.startNodeWithConfig(nodeId, {
      providers: [
        {
          name: providerName,
          baseUrl: this.mockOpenAI.baseUrl,
        },
      ],
    });
  },
);

Given(
  'a running memeloop node {string} with mcp servers:',
  async function (
    this: NodeWorld,
    nodeId: string,
    table: { hashes(): Array<Record<string, string>> },
  ) {
    const hashes = table.hashes();
    const mcpServers = hashes.map((row) => ({
      name: row.name,
      command: row.command,
    }));
    await this.startNodeWithConfig(nodeId, { mcpServers });
  },
);

Given("a wiki base directory for tests", async function (this: NodeWorld) {
  // 只需要让 node.getInfo 的 hasWiki 逻辑返回 true；
  // 不实际调用 knowledge.* 的话，不必保证 tiddlywiki.info 存在。
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memeloop-wiki-base-"));
  this.wikiBaseDir = base;
});

When(
  'I connect from {string} to {string} via WebSocket',
  async function (this: NodeWorld, fromId: string, toId: string) {
    const target = this.nodes.get(toId);
    if (!target) {
      throw new Error(`Target node not started: ${toId}`);
    }
    const mgr = this.getOrCreatePeerManager(fromId);
    const wsUrl = `ws://127.0.0.1:${target.port}`;
    await mgr.addPeerByUrl(wsUrl);
  },
);

Then(
  'node {string} should see a peer with nodeId {string}',
  function (this: NodeWorld, localId: string, peerId: string) {
    const mgr = this.getOrCreatePeerManager(localId);
    const peers = mgr.getPeers();
    const found = peers.some((p) => p.identity.nodeId === peerId);
    if (!found) {
      throw new Error(
        `Expected node ${localId} to see peer ${peerId}, but peers were: ${JSON.stringify(
          peers.map((p) => p.identity.nodeId),
        )}`,
      );
    }
  },
);

Then(
  'calling {string} on peer {string} from {string} should return nodeId {string}',
  async function (
    this: NodeWorld,
    method: string,
    remoteId: string,
    localId: string,
    expectedNodeId: string,
  ) {
    const mgr = this.getOrCreatePeerManager(localId);
    const result = (await mgr.sendRpcToNode(remoteId, method, {})) as { nodeId?: string };
    if (result.nodeId !== expectedNodeId) {
      throw new Error(
        `Expected ${method} on ${remoteId} from ${localId} to return nodeId=${expectedNodeId}, got ${result.nodeId}`,
      );
    }
  },
);

After(async function (this: NodeWorld) {
  await this.shutdown();
});

