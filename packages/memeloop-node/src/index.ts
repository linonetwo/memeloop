export { loadConfig, saveConfig, getDefaultConfigPath } from "./config.js";
export type { NodeConfig, ProviderEntry, ToolPermissionConfig } from "./config.js";
export { createNodeRuntime } from "./runtime/index.js";
export type { NodeRuntimeOptions, NodeRuntimeResult } from "./runtime/index.js";
export { TerminalSessionManager } from "./terminal/index.js";
export type {
  ITerminalSessionManager,
  StartSessionOptions,
  TerminalSessionInfo,
  TerminalOutputChunk,
  TerminalInteractionPrompt,
} from "./terminal/index.js";
export { FileWikiManager } from "./knowledge/index.js";
export type { IWikiManager, TiddlerFields } from "./knowledge/index.js";

// Network: node server, RPC, peer management
export { createNodeServer, startNodeServerWithMdns } from "./network/index.js";
export type { NodeServerOptions } from "./network/index.js";
export { PeerConnectionManager } from "./network/index.js";
export type { PeerConnectionManagerOptions } from "./network/index.js";
export { handleRpc } from "./network/index.js";
export type { RpcHandlerContext } from "./network/index.js";
