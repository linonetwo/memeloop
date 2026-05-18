export { TerminalSessionManager } from "./sessionManager.js";
export type { ITerminalSessionManager, StartSessionOptions, TerminalSessionMode } from "./sessionManager.js";
export type {
  TerminalSessionInfo,
  TerminalSessionStatus,
  TerminalOutputChunk,
  TerminalFollowResult,
  TerminalInteractionPrompt,
} from "./types.js";
export {
  createThrottledTerminalOutputNotify,
  type ThrottledTerminalNotify,
} from "./throttleOutputNotify.js";
