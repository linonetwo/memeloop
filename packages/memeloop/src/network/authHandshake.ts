/**
 * WS auth handshake: first message after connect must be memeloop.auth.handshake.
 * Build/parse handshake message; actual credential verification is server-side.
 */

import type { AuthHandshakeParams } from "@memeloop/protocol";

const AUTH_METHOD = "memeloop.auth.handshake";

/**
 * Build the first message to send after WS open: JSON-RPC request for auth handshake.
 * Send this as the first message; server must respond success or close the connection.
 */
export function buildAuthHandshakeMessage(params: AuthHandshakeParams): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: AUTH_METHOD,
    params: {
      nodeId: params.nodeId,
      authType: params.authType,
      credential: params.credential,
    },
  });
}

export interface ParsedHandshake {
  nodeId: string;
  authType: "pairingToken" | "jwt" | "pin";
  credential: string;
}

/**
 * Parse incoming message; if it's an auth handshake request, return params.
 * Returns null if the message is not memeloop.auth.handshake.
 */
export function parseAuthHandshakeMessage(data: string): ParsedHandshake | null {
  let msg: { method?: string; params?: AuthHandshakeParams };
  try {
    msg = JSON.parse(data) as typeof msg;
  } catch {
    return null;
  }
  if (msg.method !== AUTH_METHOD || !msg.params) return null;
  const p = msg.params;
  if (typeof p.nodeId !== "string" || typeof p.authType !== "string" || typeof p.credential !== "string") {
    return null;
  }
  return { nodeId: p.nodeId, authType: p.authType as ParsedHandshake["authType"], credential: p.credential };
}
