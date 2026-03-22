/**
 * WebSocket connection manager: connect, disconnect, auto-reconnect, heartbeat.
 * Used by node/desktop/mobile for JSON-RPC over WS.
 */

export type ConnectionState = "closed" | "connecting" | "open";

export interface ConnectionManagerOptions {
  /** Auto-reconnect on close (default true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts (default 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay ms (default 1000) */
  reconnectDelayMs?: number;
  /** Heartbeat interval ms; 0 = no heartbeat (default 30000) */
  heartbeatIntervalMs?: number;
  /** Callback to send auth as first message after open; if returns a string, send it */
  onOpenSendAuth?: () => string | Promise<string | undefined>;
}

const defaultOptions: Required<Omit<ConnectionManagerOptions, "onOpenSendAuth">> & {
  onOpenSendAuth?: () => string | Promise<string | undefined>;
} = {
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectDelayMs: 1000,
  heartbeatIntervalMs: 30_000,
};

export class ConnectionManager {
  private url: string;
  private ws: WebSocket | null = null;
  private state: ConnectionState = "closed";
  private opts: Required<Omit<ConnectionManagerOptions, "onOpenSendAuth">> & {
    onOpenSendAuth?: () => string | Promise<string | undefined>;
  };
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private onMessageCb: ((data: string) => void) | null = null;
  private onOpenCb: (() => void) | null = null;
  private onCloseCb: ((event: { code?: number; reason?: string }) => void) | null = null;

  constructor(url: string, options: ConnectionManagerOptions = {}) {
    this.url = url;
    this.opts = { ...defaultOptions, ...options };
  }

  getState(): ConnectionState {
    return this.state;
  }

  connect(): void {
    if (this.state === "connecting" || this.state === "open") {
      return;
    }
    this.state = "connecting";
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onclose = (event) => this.handleClose(event);
      this.ws.onerror = () => { /* logged via onclose */ };
    } catch (err) {
      this.state = "closed";
      this.scheduleReconnect();
    }
  }

  private async handleOpen(): Promise<void> {
    this.state = "open";
    this.reconnectAttempts = 0;

    if (this.opts.onOpenSendAuth) {
      try {
        const authPayload = await this.opts.onOpenSendAuth();
        if (authPayload && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(authPayload);
        }
      } catch (_) {
        // ignore auth send failure
      }
    }

    if (this.opts.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.opts.heartbeatIntervalMs);
    }
    this.onOpenCb?.();
  }

  private sendHeartbeat(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: null }));
    }
  }

  private handleMessage(event: MessageEvent): void {
    const data = typeof event.data === "string" ? event.data : "";
    this.onMessageCb?.(data);
  }

  private handleClose(event: CloseEvent): void {
    this.state = "closed";
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.ws = null;
    this.onCloseCb?.({ code: event.code, reason: event.reason });
    if (this.opts.autoReconnect && this.reconnectAttempts < this.opts.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = this.opts.reconnectDelayMs * Math.min(this.reconnectAttempts, 10);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.opts.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = "closed";
  }

  send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  onMessage(cb: (data: string) => void): void {
    this.onMessageCb = cb;
  }

  onOpen(cb: () => void): void {
    this.onOpenCb = cb;
  }

  onClose(cb: (event: { code?: number; reason?: string }) => void): void {
    this.onCloseCb = cb;
  }
}
