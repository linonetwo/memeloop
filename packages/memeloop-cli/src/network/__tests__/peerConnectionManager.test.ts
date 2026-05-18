import { describe, expect, it, vi } from "vitest";
let remoteNodeId = "node-remote";
let noReplyMethod: string | null = null;

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    default: class MockWs extends EventEmitter {
      static OPEN = 1;
      readyState = 1;
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        queueMicrotask(() => this.emit("open"));
      }
      send(data: string) {
        const parsed = JSON.parse(data) as any;
        if (parsed?.method === "memeloop.node.getInfo") {
          queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({
            id: parsed.id,
            result: { nodeId: remoteNodeId, capabilities: { tools: ["a"], hasWiki: true, mcpServers: ["m1"], imChannels: ["c1"] } },
          }))));
          return;
        }
        if (parsed?.id === 1 || parsed?.method === "memeloop.auth.handshake") {
          queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ id: 1, result: { ok: true } }))));
          return;
        }
        if (noReplyMethod && parsed?.method === noReplyMethod) {
          return;
        }
        queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ id: parsed.id, result: { ok: true, echo: parsed.method } }))));
      }
      close() {
        this.readyState = 3;
        this.emit("close");
      }
    },
  };
});

import { PeerConnectionManager } from "../peerConnectionManager.js";

describe("PeerConnectionManager", () => {
  it("validates ws url and connection state branches", async () => {
    const m = new PeerConnectionManager({ localNodeId: "local" });
    await expect(m.addPeerByUrl("http://bad")).rejects.toThrow("URL must be ws:// or wss://");
    await expect(m.sendRpcToNode("missing", "x", {})).rejects.toThrow("Not connected to node");
  });

  it("connects, gets peer info, sendRpc, list/remove/shutdown", async () => {
    const m = new PeerConnectionManager({ localNodeId: "local", requestTimeoutMs: 5000 });
    const { nodeId } = await m.addPeerByUrl("ws://127.0.0.1:9999");
    expect(nodeId).toBe("node-remote");

    const peers = m.getPeers();
    expect(peers.length).toBe(1);
    expect(peers[0].identity.nodeId).toBe("node-remote");
    expect(peers[0].capabilities.hasWiki).toBe(true);

    const rpc = await m.sendRpcToNode("node-remote", "memeloop.node.getInfo", {});
    expect((rpc as any).nodeId).toBe("node-remote");

    m.removePeer("node-remote");
    expect(m.getPeerNodeIds()).toEqual([]);

    m.shutdown();
    expect(m.getPeers()).toEqual([]);
  });

  it("rejects when already connecting to the same URL", async () => {
    remoteNodeId = "node-remote";
    noReplyMethod = null;
    const m = new PeerConnectionManager({ localNodeId: "local", requestTimeoutMs: 2000 });

    // Start first connection without awaiting, so `connectingByUrl` entry is present.
    const p1 = m.addPeerByUrl("ws://127.0.0.1:9998");
    await expect(m.addPeerByUrl("ws://127.0.0.1:9998")).rejects.toThrow("Already connecting to this URL");
    await p1;
  });

  it("covers branch when remote node doesn't return nodeId", async () => {
    remoteNodeId = "";
    noReplyMethod = null;
    const m = new PeerConnectionManager({ localNodeId: "local", requestTimeoutMs: 2000 });
    await expect(m.addPeerByUrl("ws://127.0.0.1:9997")).rejects.toThrow("Remote node did not return nodeId");
    remoteNodeId = "node-remote";
  });

  it("returns existing nodeId when peer already exists", async () => {
    remoteNodeId = "node-remote";
    noReplyMethod = null;
    const m = new PeerConnectionManager({ localNodeId: "local", requestTimeoutMs: 2000 });

    await m.addPeerByUrl("ws://127.0.0.1:9996");
    const before = m.getPeers();
    const r2 = await m.addPeerByUrl("ws://127.0.0.1:9995");
    const after = m.getPeers();

    expect(r2.nodeId).toBe("node-remote");
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
  });

  it("covers JSON-RPC request timeout branch in sendRpcToNode", async () => {
    remoteNodeId = "node-remote";
    noReplyMethod = "never.reply";

    const m = new PeerConnectionManager({ localNodeId: "local", requestTimeoutMs: 30 });
    await m.addPeerByUrl("ws://127.0.0.1:9994");
    await expect(m.sendRpcToNode("node-remote", "never.reply", {})).rejects.toThrow(/JSON-RPC timeout/);

    noReplyMethod = null;
  });
});

