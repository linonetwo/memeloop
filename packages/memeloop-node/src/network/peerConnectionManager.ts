/**
 * Outbound peer connections: WS client per node, handshake + JSON-RPC request/response.
 * Used by hosts (desktop, CLI) for getPeers() and sendRpcToNode().
 */

import WebSocket from "ws";

import type { NodeStatus, WikiInfo } from "@memeloop/protocol";
import { buildAuthHandshakeMessage } from "memeloop";

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** Single outbound WS connection to a memeloop node: handshake then JSON-RPC. */
class PeerConnection {
  private url: string;
  private localNodeId: string;
  private handshakeCredential: string;
  private ws: InstanceType<typeof WebSocket> | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private authDone: Promise<void>;
  private resolveAuth!: () => void;
  private nodeStatus: NodeStatus | null = null;

  constructor(url: string, localNodeId: string, handshakeCredential = "") {
    this.url = url;
    this.localNodeId = localNodeId;
    this.handshakeCredential = handshakeCredential;
    this.authDone = new Promise<void>((resolve) => {
      this.resolveAuth = resolve;
    });
  }

  getNodeStatus(): NodeStatus | null {
    return this.nodeStatus;
  }

  setNodeStatus(status: NodeStatus): void {
    this.nodeStatus = status;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const onOpen = (): void => {
        const msg = buildAuthHandshakeMessage({
          nodeId: this.localNodeId,
          authType: "pin",
          credential: this.handshakeCredential,
        });
        this.ws!.send(msg);
        resolve();
      };

      const onMessage = (data: Buffer | ArrayBuffer): void => {
        const raw = Buffer.isBuffer(data) ? data.toString() : String(data);
        let msg: { id?: number | null; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(raw) as typeof msg;
        } catch {
          return;
        }
        if (msg.id !== undefined && msg.id !== null) {
          const pr = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (pr) {
            clearTimeout(pr.timeoutId);
            if (msg.error) {
              pr.reject(new Error(msg.error.message ?? "JSON-RPC error"));
            } else {
              pr.resolve(msg.result);
            }
          } else if (msg.id === 1) {
            this.resolveAuth();
          }
        }
      };

      const onClose = (): void => {
        this.ws = null;
        for (const pr of this.pending.values()) {
          clearTimeout(pr.timeoutId);
          pr.reject(new Error("WebSocket closed"));
        }
        this.pending.clear();
      };

      const onError = (err: Error): void => {
        reject(err);
      };

      this.ws.on("open", onOpen);
      this.ws.on("message", onMessage);
      this.ws.on("close", onClose);
      this.ws.on("error", onError);
    });
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Promise<T> {
    return this.authDone.then(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("WebSocket not open"));
      }
      const id = this.nextId++;
      const payload = { jsonrpc: "2.0" as const, id, method, params };
      return new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`JSON-RPC timeout: ${method} (${timeoutMs}ms)`));
        }, timeoutMs);
        this.pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeoutId,
        });
        this.ws!.send(JSON.stringify(payload));
      });
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    for (const pr of this.pending.values()) {
      clearTimeout(pr.timeoutId);
      pr.reject(new Error("Connection closed"));
    }
    this.pending.clear();
  }
}

/** Build NodeStatus from memeloop.node.getInfo result (nodeId + capabilities). */
function nodeStatusFromGetInfo(
  nodeId: string,
  info: {
    nodeId?: string;
    capabilities?: {
      tools?: string[];
      mcpServers?: string[];
      hasWiki?: boolean;
      imChannels?: string[];
      wikis?: WikiInfo[];
    };
  },
): NodeStatus {
  const cap = info.capabilities ?? {};
  const wikis = Array.isArray(cap.wikis) ? cap.wikis : [];
  return {
    identity: {
      nodeId: info.nodeId ?? nodeId,
      userId: "",
      name: nodeId,
      type: "node",
    },
    capabilities: {
      tools: cap.tools ?? [],
      mcpServers: cap.mcpServers ?? [],
      hasWiki: cap.hasWiki ?? false,
      imChannels: Array.isArray(cap.imChannels) ? cap.imChannels : [],
      wikis,
    },
    connectivity: {},
    status: "online",
    lastSeen: Date.now(),
  };
}

export interface PeerConnectionManagerOptions {
  localNodeId: string;
  requestTimeoutMs?: number;
  /** Sent as memeloop.auth.handshake credential when authType is pin */
  handshakeCredential?: string;
}

/**
 * Manages outbound WS connections to other memeloop nodes.
 * addPeerByUrl(wsUrl) connects, handshakes, fetches node.getInfo, stores by nodeId.
 */
export class PeerConnectionManager {
  private localNodeId: string;
  private requestTimeoutMs: number;
  private handshakeCredential: string;
  /** nodeId -> connection (only after getInfo succeeded). */
  private peers = new Map<string, PeerConnection>();
  /** wsUrl -> connection (while connecting, before we have nodeId). */
  private connectingByUrl = new Map<string, PeerConnection>();

  constructor(options: PeerConnectionManagerOptions) {
    this.localNodeId = options.localNodeId;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.handshakeCredential = options.handshakeCredential ?? "";
  }

  async addPeerByUrl(wsUrl: string): Promise<{ nodeId: string }> {
    const normalized = wsUrl.trim();
    if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
      throw new Error("URL must be ws:// or wss://");
    }
    if (this.connectingByUrl.has(normalized)) {
      throw new Error("Already connecting to this URL");
    }

    const conn = new PeerConnection(normalized, this.localNodeId, this.handshakeCredential);
    this.connectingByUrl.set(normalized, conn);

    try {
      await conn.connect();
      const info = (await conn.request<{ nodeId: string; capabilities?: Record<string, unknown> }>(
        "memeloop.node.getInfo",
        {},
        this.requestTimeoutMs,
      )) as { nodeId: string; capabilities?: { tools?: string[]; mcpServers?: string[]; hasWiki?: boolean } };
      const nodeId = info?.nodeId ?? "";
      if (!nodeId) {
        throw new Error("Remote node did not return nodeId");
      }
      if (this.peers.has(nodeId)) {
        conn.disconnect();
        this.connectingByUrl.delete(normalized);
        return { nodeId };
      }
      const status = nodeStatusFromGetInfo(nodeId, info);
      conn.setNodeStatus(status);
      this.peers.set(nodeId, conn);
      this.connectingByUrl.delete(normalized);
      return { nodeId };
    } catch (err) {
      conn.disconnect();
      this.connectingByUrl.delete(normalized);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  removePeer(nodeId: string): void {
    const conn = this.peers.get(nodeId);
    if (conn) {
      conn.disconnect();
      this.peers.delete(nodeId);
    }
  }

  getPeers(): NodeStatus[] {
    const list: NodeStatus[] = [];
    for (const conn of this.peers.values()) {
      const status = conn.getNodeStatus();
      if (status) {
        list.push({ ...status, lastSeen: Date.now() });
      }
    }
    return list;
  }

  /** 当前已连接远端节点的 `nodeId` 列表（用于 ChatSyncEngine peers）。 */
  getPeerNodeIds(): string[] {
    return [...this.peers.keys()];
  }

  async sendRpcToNode(nodeId: string, method: string, params: unknown): Promise<unknown> {
    const conn = this.peers.get(nodeId);
    if (!conn) {
      throw new Error(`Not connected to node: ${nodeId}`);
    }
    return conn.request(method, params, this.requestTimeoutMs);
  }

  /**
   * Close all peer connections and clear internal state.
   * Intended for graceful shutdown in tests or process exit.
   */
  shutdown(): void {
    for (const conn of this.peers.values()) {
      conn.disconnect();
    }
    this.peers.clear();
    for (const conn of this.connectingByUrl.values()) {
      conn.disconnect();
    }
    this.connectingByUrl.clear();
  }
}

