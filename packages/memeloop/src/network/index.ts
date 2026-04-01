/**
 * WebSocket + JSON-RPC 2.0 transport: ConnectionManager, MessageRouter, auth.
 */

export { ConnectionManager } from "./connectionManager.js";
export type { ConnectionManagerOptions, ConnectionState } from "./connectionManager.js";

export { MessageRouter } from "./messageRouter.js";
export type { MessageRouterOptions, NotificationHandler } from "./messageRouter.js";

export { buildAuthHandshakeMessage, parseAuthHandshakeMessage } from "./authHandshake.js";
export type { ParsedHandshake } from "./authHandshake.js";

export { generatePin, createPairingToken, verifyPairingToken } from "./pinPairing.js";

export { register, browse, MEMELOOP_SERVICE_TYPE } from "./lanDiscovery.js";
export type {
  MemeloopServiceInfo,
  LanDiscoveryRegisterOptions,
  LanDiscoveryBrowseOptions,
} from "./lanDiscovery.js";

export {
  detectPublicIP,
  resolveConnectAddress,
  ConnectivityManager,
} from "./connectivity.js";
export type {
  ConnectivityState,
  FrpTunnelOptions,
  FrpTunnelStop,
} from "./connectivity.js";

export { createNodeServer, createGitProxyHandler } from "./nodeServer.js";

export {
  encryptNoiseFrame,
  decryptNoiseFrame,
  NoiseJsonRpcCodec,
} from "./noiseTransport.js";

export {
  completeNoiseXxHandshake,
  createNoiseXxInitiator,
  createNoiseXxResponder,
  generateX25519KeyPairForNoise,
  getNoiseXxPeerCryptoMaterial,
  MEMELOOP_NOISE_PROLOGUE_V1,
} from "./noiseXxHandshake.js";
export type {
  NoiseStaticKeyPair,
  NoiseXxHandshakePeer,
  NoiseXxHandshakeResult,
} from "./noiseXxHandshake.js";

export {
  computePinConfirmCode,
  verifyPinConfirmCode,
} from "./pinConfirmCode.js";
export {
  loadKnownNodes,
  saveKnownNodes,
  upsertKnownNode,
  removeKnownNode,
  trustMatchesStored,
  getDefaultKnownNodesPath,
} from "./knownNodesStore.js";
export type {
  CreateNodeServerOptions,
  NodeRpcContext,
  NodeRpcHandler,
  NodeGitHandler,
  WsAuthOptions,
  ImWebhookHandler,
} from "./nodeServer.js";
