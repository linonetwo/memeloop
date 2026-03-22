/**
 * ITerminalSessionManager: start/manage long-running commands, stream stdout/stderr,
 * stdin write, interaction detection (timeout + regex prompt), process lifecycle, session list.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as crypto from "node:crypto";

import type {
  TerminalSessionInfo,
  TerminalSessionStatus,
  TerminalOutputChunk,
  TerminalInteractionPrompt,
} from "./types.js";

export interface StartSessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Regex patterns to detect "prompt" (e.g. ">$ ", "Password:") for interaction detection */
  promptPatterns?: { name: string; regex: RegExp }[];
  /** If no output for this many ms, emit interaction prompt (optional) */
  idleTimeoutMs?: number;
}

export interface ITerminalSessionManager {
  start(options: StartSessionOptions): Promise<{ sessionId: string }>;
  list(): Promise<TerminalSessionInfo[]>;
  get(sessionId: string): TerminalSessionInfo | undefined;
  respond(sessionId: string, input: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  onOutput(listener: (chunk: TerminalOutputChunk) => void): () => void;
  onInteractionPrompt(listener: (prompt: TerminalInteractionPrompt) => void): () => void;
}

interface SessionState {
  sessionId: string;
  command: string;
  cwd: string;
  status: TerminalSessionStatus;
  exitCode: number | null;
  startedAt: number;
  exitedAt?: number;
  process: ChildProcess;
  idleTimer?: ReturnType<typeof setTimeout>;
  promptPatterns?: { name: string; regex: RegExp }[];
  idleTimeoutMs?: number;
  buffer: string;
}

export class TerminalSessionManager extends EventEmitter implements ITerminalSessionManager {
  private sessions = new Map<string, SessionState>();
  private outputListeners = new Set<(chunk: TerminalOutputChunk) => void>();
  private promptListeners = new Set<(prompt: TerminalInteractionPrompt) => void>();

  async start(options: StartSessionOptions): Promise<{ sessionId: string }> {
    const sessionId = crypto.randomUUID();
    const cwd = options.cwd ?? process.cwd();
    const args = options.args ?? [];
    const env = { ...process.env, ...options.env };

    const proc = spawn(options.command, args, {
      cwd,
      env,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const state: SessionState = {
      sessionId,
      command: [options.command, ...args].join(" "),
      cwd,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      process: proc,
      promptPatterns: options.promptPatterns,
      idleTimeoutMs: options.idleTimeoutMs,
      buffer: "",
    };
    this.sessions.set(sessionId, state);

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      this.pushOutput(sessionId, "stdout", text, state);
    });
    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      this.pushOutput(sessionId, "stderr", text, state);
    });

    proc.on("exit", (code, signal) => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      s.status = signal ? "killed" : "exited";
      s.exitCode = code;
      s.exitedAt = Date.now();
      if (s.idleTimer) clearTimeout(s.idleTimer);
    });
    proc.on("error", () => {
      const s = this.sessions.get(sessionId);
      if (s) s.status = "exited";
    });

    if (options.idleTimeoutMs) {
      this.scheduleIdlePrompt(sessionId, state);
    }

    return { sessionId };
  }

  private pushOutput(
    sessionId: string,
    stream: "stdout" | "stderr",
    text: string,
    state: SessionState,
  ): void {
    const timestamp = Date.now();
    const chunk: TerminalOutputChunk = { sessionId, stream, data: text, timestamp };
    for (const fn of this.outputListeners) fn(chunk);

    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = undefined;
    }

    state.buffer += text;
    if (state.promptPatterns?.length) {
      for (const { name, regex } of state.promptPatterns) {
        if (regex.test(state.buffer)) {
          const prompt: TerminalInteractionPrompt = {
            sessionId,
            promptText: state.buffer.slice(-200),
            patternName: name,
            timestamp,
          };
          for (const fn of this.promptListeners) fn(prompt);
          state.buffer = "";
          break;
        }
      }
    }

    if (state.idleTimeoutMs) {
      this.scheduleIdlePrompt(sessionId, state);
    }
  }

  private scheduleIdlePrompt(sessionId: string, state: SessionState): void {
    if (state.status !== "running" || !state.idleTimeoutMs) return;
    state.idleTimer = setTimeout(() => {
      state.idleTimer = undefined;
      const prompt: TerminalInteractionPrompt = {
        sessionId,
        promptText: state.buffer || "(no output yet)",
        timestamp: Date.now(),
      };
      for (const fn of this.promptListeners) fn(prompt);
    }, state.idleTimeoutMs);
  }

  async list(): Promise<TerminalSessionInfo[]> {
    return Array.from(this.sessions.values()).map((s) => this.toInfo(s));
  }

  get(sessionId: string): TerminalSessionInfo | undefined {
    const s = this.sessions.get(sessionId);
    return s ? this.toInfo(s) : undefined;
  }

  private toInfo(s: SessionState): TerminalSessionInfo {
    return {
      sessionId: s.sessionId,
      command: s.command,
      cwd: s.cwd,
      status: s.status,
      exitCode: s.exitCode,
      startedAt: s.startedAt,
      exitedAt: s.exitedAt,
    };
  }

  async respond(sessionId: string, input: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session not found: ${sessionId}`);
    if (s.status !== "running" || !s.process.stdin?.writable) {
      throw new Error(`Session not writable: ${sessionId}`);
    }
    s.process.stdin.write(input + "\n");
  }

  async cancel(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.idleTimer) {
      clearTimeout(s.idleTimer);
      s.idleTimer = undefined;
    }
    s.process.kill("SIGTERM");
    s.status = "killed";
    s.exitedAt = Date.now();
  }

  onOutput(listener: (chunk: TerminalOutputChunk) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onInteractionPrompt(listener: (prompt: TerminalInteractionPrompt) => void): () => void {
    this.promptListeners.add(listener);
    return () => this.promptListeners.delete(listener);
  }
}
