import type http from "node:http";

import { setWorldConstructor } from "@cucumber/cucumber";

import { PeerConnectionManager } from "../../src/network/index";
import { getDefaultConfigPath, loadConfig, saveConfig } from "../../src/config";
import { createLanPinWsAuth } from "../../src/auth/wsAuth";
import type { StartedTestNode } from "../../src/testing/testNode";
import { startTestNode } from "../../src/testing/testNode";
import { TerminalSessionManager } from "../../src/terminal/sessionManager";

export class NodeWorld {
  nodes = new Map<string, StartedTestNode>();
  peers = new Map<string, PeerConnectionManager>();
  terminalManager = new TerminalSessionManager();
  mockOpenAI?: { baseUrl: string; stop: () => Promise<void> };
  lastConversationIdByNode = new Map<string, string>();
  lastTerminalSessionId?: string;
  mockCloud?: { baseUrl: string; stop: () => Promise<void> };
  cloudState?: { nodeId: string; nodeSecret: string; jwt: string };
  wikiBaseDir?: string;
  /** When set, node WebSocket requires memeloop.auth.handshake with matching PIN (authType pin). */
  strictLanPin?: string;
  authConfigPath = getDefaultConfigPath(process.cwd());
  /** Credential sent in outbound handshake (PeerConnectionManager). */
  handshakeCredential = "";
  rawWs?: { close(): void };

  private buildWsAuth() {
    if (this.strictLanPin == null || this.strictLanPin === "") return undefined;
    const cfg = loadConfig(this.authConfigPath);
    cfg.auth = {
      ...cfg.auth,
      ws: {
        enabled: cfg.auth?.ws?.enabled ?? true,
        mode: "lan-pin",
        pin: this.strictLanPin,
      },
      lanPinState: cfg.auth?.lanPinState ?? { failCount: 0, nextAllowedAt: 0 },
    };
    saveConfig(cfg, this.authConfigPath);
    return createLanPinWsAuth(cfg, this.authConfigPath);
  }

  async startNode(nodeId: string): Promise<StartedTestNode> {
    if (this.nodes.has(nodeId)) {
      return this.nodes.get(nodeId)!;
    }
    const started = await startTestNode(nodeId, {
      terminalManager: this.terminalManager,
      wikiBasePath: this.wikiBaseDir,
      wsAuth: this.buildWsAuth(),
    });
    this.nodes.set(nodeId, started);
    return started;
  }

  async startNodeWithConfig(nodeId: string, config: Partial<import("../../src/config").NodeConfig>): Promise<StartedTestNode> {
    if (this.nodes.has(nodeId)) {
      return this.nodes.get(nodeId)!;
    }
    const started = await startTestNode(nodeId, {
      config,
      terminalManager: this.terminalManager,
      wikiBasePath: this.wikiBaseDir,
      wsAuth: this.buildWsAuth(),
    });
    this.nodes.set(nodeId, started);
    return started;
  }

  getOrCreatePeerManager(localNodeId: string): PeerConnectionManager {
    let mgr = this.peers.get(localNodeId);
    if (!mgr) {
      mgr = new PeerConnectionManager({
        localNodeId,
        handshakeCredential: this.handshakeCredential,
      });
      this.peers.set(localNodeId, mgr);
    }
    return mgr;
  }

  async shutdown(): Promise<void> {
    if (this.rawWs) {
      try {
        this.rawWs.close();
      } catch {
        /* ignore */
      }
      this.rawWs = undefined;
    }
    this.strictLanPin = undefined;
    this.handshakeCredential = "";
    for (const mgr of this.peers.values()) {
      mgr.shutdown();
    }
    this.peers.clear();
    if (this.mockOpenAI) {
      await this.mockOpenAI.stop();
      this.mockOpenAI = undefined;
    }
    if (this.mockCloud) {
      await this.mockCloud.stop();
      this.mockCloud = undefined;
    }
    const closePromises: Promise<void>[] = [];
    for (const started of this.nodes.values()) {
      const server: http.Server = started.server;
      closePromises.push(
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
      );
    }
    this.nodes.clear();
    await Promise.all(closePromises);
  }
}

setWorldConstructor(NodeWorld);

