import { describe, expect, it, vi } from "vitest";

import {
  autoConnectDiscoveredPeer,
  buildDiscoveredPeerWsUrl,
} from "../lanAutoConnect.js";

describe("lanAutoConnect", () => {
  it("buildDiscoveredPeerWsUrl builds ws url with normalized path", () => {
    expect(
      buildDiscoveredPeerWsUrl({
        name: "n1",
        host: "127.0.0.1",
        port: 38472,
        wsPath: "ws",
      }),
    ).toBe("ws://127.0.0.1:38472/ws");
  });

  it("autoConnectDiscoveredPeer skips self node", async () => {
    const peerConnector = { addPeerByUrl: vi.fn() };
    const ok = await autoConnectDiscoveredPeer(
      {
        name: "self",
        host: "127.0.0.1",
        port: 38472,
        nodeId: "node-self",
      },
      "node-self",
      peerConnector,
    );
    expect(ok).toBe(false);
    expect(peerConnector.addPeerByUrl).not.toHaveBeenCalled();
  });

  it("autoConnectDiscoveredPeer connects remote node", async () => {
    const peerConnector = {
      addPeerByUrl: vi.fn().mockResolvedValue({ nodeId: "node-remote" }),
    };
    const ok = await autoConnectDiscoveredPeer(
      {
        name: "remote",
        host: "192.168.1.20",
        port: 38472,
        nodeId: "node-remote",
        wsPath: "/",
      },
      "node-self",
      peerConnector,
    );
    expect(ok).toBe(true);
    expect(peerConnector.addPeerByUrl).toHaveBeenCalledWith(
      "ws://192.168.1.20:38472/",
    );
  });

  it("autoConnectDiscoveredPeer returns false when peerConnector throws", async () => {
    const peerConnector = {
      addPeerByUrl: vi.fn().mockRejectedValueOnce(new Error("boom")),
    };
    const ok = await autoConnectDiscoveredPeer(
      {
        name: "remote",
        host: "192.168.1.20",
        port: 38472,
        nodeId: "node-remote",
        wsPath: "/",
      },
      "node-self",
      peerConnector,
    );
    expect(ok).toBe(false);
    expect(peerConnector.addPeerByUrl).toHaveBeenCalledWith("ws://192.168.1.20:38472/");
  });
});
