/**
 * Node server: delegates to memeloop's createNodeServer; adds startNodeServerWithMdns (listen + mDNS).
 */

import http from "node:http";
import {
  createNodeServer as createNodeServerFromMemeloop,
  register,
  type ImWebhookHandler,
  type WsAuthOptions,
} from "memeloop";

import { handleRpc, type RpcHandlerContext } from "./rpcHandlers";

export interface NodeServerOptions {
  port: number;
  nodeId: string;
  rpcContext: RpcHandlerContext;
  /** Git proxy: getBackendUrl + verifyAuth. If not set, /git/* is 404. */
  gitProxy?: {
    getBackendUrl(wikiId: string): Promise<string | null> | null;
    verifyAuth(authHeader: string | undefined): Promise<boolean>;
  };
  /** mDNS service name */
  serviceName?: string;
  /** WebSocket: require memeloop.auth.handshake first and verify credentials */
  wsAuth?: WsAuthOptions;
  /** POST /im/webhook/<channelId> */
  imWebhookHandler?: ImWebhookHandler;
}

export function createNodeServer(options: NodeServerOptions): http.Server {
  const { nodeId, rpcContext, gitProxy, wsAuth, imWebhookHandler } = options;
  return createNodeServerFromMemeloop({
    nodeId,
    rpcHandler: (method, params, wsCtx) =>
      handleRpc(
        {
          ...rpcContext,
          notify: wsCtx?.notify,
        },
        method,
        params,
      ),
    gitHandler: gitProxy,
    wsAuth,
    imWebhookHandler,
  });
}

export async function startNodeServerWithMdns(
  options: NodeServerOptions,
): Promise<http.Server> {
  const server = createNodeServer(options);
  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, () => resolve()).on("error", reject);
  });
  if (process.env.NODE_ENV === "test" || process.env.MEMELOOP_DISABLE_MDNS === "1") {
    return server;
  }
  try {
    register({
      name: options.serviceName ?? "memeloop-node",
      port: options.port,
      nodeId: options.nodeId,
    });
  } catch {
    // mDNS optional
  }
  return server;
}
