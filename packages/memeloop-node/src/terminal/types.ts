/**
 * Terminal session types for ITerminalSessionManager.
 */

export type TerminalSessionStatus = "running" | "exited" | "killed" | "timeout";

export interface TerminalSessionInfo {
  sessionId: string;
  command: string;
  cwd: string;
  status: TerminalSessionStatus;
  exitCode: number | null;
  startedAt: number;
  exitedAt?: number;
}

export interface TerminalOutputChunk {
  sessionId: string;
  stream: "stdout" | "stderr";
  data: string;
  timestamp: number;
}

export interface TerminalInteractionPrompt {
  sessionId: string;
  promptText: string;
  /** Matched regex pattern name if configured */
  patternName?: string;
  timestamp: number;
}
