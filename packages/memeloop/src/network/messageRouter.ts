/**
 * JSON-RPC 2.0 message router: request/response matching, notifications, timeout.
 */

import type { JsonRpcRequest } from "@memeloop/protocol";

export interface MessageRouterOptions {
  /** Default request timeout ms (default 30000) */
  defaultTimeoutMs?: number;
  /** Send function (e.g. connectionManager.send) */
  send: (data: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export type NotificationHandler = (method: string, params: unknown) => void;

export class MessageRouter {
  private nextId = 1;
  private pending = new Map<string | number, PendingRequest>();
  private send: (data: string) => void;
  private defaultTimeoutMs: number;
  private notificationHandlers: NotificationHandler[] = [];

  constructor(options: MessageRouterOptions) {
    this.send = options.send;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const id = this.nextId++;
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JSON-RPC timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      this.send(JSON.stringify(payload));
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  notify(method: string, params?: unknown): void {
    const payload = { jsonrpc: "2.0" as const, id: null, method, params };
    this.send(JSON.stringify(payload));
  }

  /**
   * Handle incoming message (call from ConnectionManager.onMessage).
   */
  handleMessage(data: string): void {
    let msg: { id?: string | number | null; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };
    try {
      msg = JSON.parse(data) as typeof msg;
    } catch {
      return;
    }

    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        if ("error" in msg && msg.error) {
          pending.reject(new Error(msg.error.message || "JSON-RPC error"));
        } else if ("result" in msg) {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error("Invalid JSON-RPC response"));
        }
      }
    } else if (msg.method !== undefined) {
      for (const h of this.notificationHandlers) {
        try {
          h(msg.method, msg.params);
        } catch (_) {
          // ignore handler errors
        }
      }
    }
  }

  /**
   * Subscribe to notifications (method + params).
   */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.push(handler);
    return () => {
      const i = this.notificationHandlers.indexOf(handler);
      if (i >= 0) this.notificationHandlers.splice(i, 1);
    };
  }
}
