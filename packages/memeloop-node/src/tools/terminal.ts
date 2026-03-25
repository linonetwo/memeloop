/**
 * Terminal tools for Agent: execute (start and wait/timeout), list sessions, respond (stdin).
 * Register with node ToolRegistry and pass ITerminalSessionManager.
 */

import type { IToolRegistry } from "memeloop";
import type { ITerminalSessionManager } from "../terminal/index.js";

const EXECUTE_ID = "terminal.execute";
const LIST_ID = "terminal.list";
const RESPOND_ID = "terminal.respond";
const FOLLOW_ID = "terminal.follow";
const CANCEL_ID = "terminal.cancel";

export function registerTerminalTools(
  registry: IToolRegistry,
  sessionManager: ITerminalSessionManager,
): void {
  registry.registerTool(EXECUTE_ID, (args: Record<string, unknown>) =>
    executeImpl(args, sessionManager),
  );
  registry.registerTool(LIST_ID, (args: Record<string, unknown>) =>
    listImpl(args, sessionManager),
  );
  registry.registerTool(RESPOND_ID, (args: Record<string, unknown>) =>
    respondImpl(args, sessionManager),
  );
  registry.registerTool(FOLLOW_ID, (args: Record<string, unknown>) =>
    followImpl(args, sessionManager),
  );
  registry.registerTool(CANCEL_ID, (args: Record<string, unknown>) =>
    cancelImpl(args, sessionManager),
  );
}

async function executeImpl(
  args: Record<string, unknown>,
  manager: ITerminalSessionManager,
): Promise<unknown> {
  const command = args.command as string | undefined;
  const timeoutMs = (args.timeoutMs as number) ?? 60_000;
  const cwd = args.cwd as string | undefined;
  const waitMode =
    args.waitMode === "until-exit" || args.waitMode === "until-timeout" || args.waitMode === "detached"
      ? (args.waitMode as "until-exit" | "until-timeout" | "detached")
      : "until-timeout";
  const maxWaitMsRaw = args.maxWaitMs as number | undefined;
  const maxWaitMs = typeof maxWaitMsRaw === "number" ? maxWaitMsRaw : timeoutMs;
  const stream = args.stream === true;

  if (!command || typeof command !== "string") {
    return {
      error: "Missing or invalid 'command'. Example: { command: 'npm run build', timeoutMs?: 60000, cwd?: '.' }",
    };
  }

  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];
  const cmdArgs = parts.slice(1);

  const { sessionId } = await manager.start({
    command: cmd,
    args: cmdArgs.length ? cmdArgs : undefined,
    cwd,
    promptPatterns: [
      { name: "generic", regex: /[?%]\s*$|>\s*$|:\s*$/m },
    ],
    idleTimeoutMs: Math.min(15_000, timeoutMs),
  });

  if (waitMode === "detached") {
    return {
      sessionId,
      status: "running",
      exitCode: null,
      timedOut: false,
      done: false,
      nextSeq: 1,
      chunks: [],
    };
  }

  const follow = await manager.follow(sessionId, {
    fromSeq: 1,
    untilExit: waitMode === "until-exit",
    maxWaitMs,
  });
  const timedOut = waitMode === "until-timeout" && !follow.done;
  if (timedOut) await manager.cancel(sessionId);
  const stdout = follow.chunks.filter((c) => c.stream === "stdout").map((c) => c.data).join("");
  const stderr = follow.chunks.filter((c) => c.stream === "stderr").map((c) => c.data).join("");

  return {
    sessionId,
    status: follow.status,
    exitCode: follow.exitCode,
    timedOut,
    done: follow.done,
    nextSeq: follow.nextSeq,
    chunks: stream ? follow.chunks : undefined,
    stdout,
    stderr,
    output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ""),
  };
}

async function listImpl(
  _args: Record<string, unknown>,
  manager: ITerminalSessionManager,
): Promise<unknown> {
  const list = await manager.list();
  return { sessions: list };
}

async function respondImpl(
  args: Record<string, unknown>,
  manager: ITerminalSessionManager,
): Promise<unknown> {
  const sessionId = args.sessionId as string | undefined;
  const input = args.input as string | undefined;

  if (!sessionId || typeof input !== "string") {
    return {
      error: "Missing sessionId or input. Example: { sessionId: 'uuid', input: 'yes' }",
    };
  }

  try {
    await manager.respond(sessionId, input);
    return { ok: true };
  } catch (e) {
    return { error: String(e) };
  }
}

async function followImpl(
  args: Record<string, unknown>,
  manager: ITerminalSessionManager,
): Promise<unknown> {
  const sessionId = args.sessionId as string | undefined;
  if (!sessionId || typeof sessionId !== "string") {
    return { error: "Missing sessionId. Example: { sessionId: 'uuid', fromSeq?: 1, untilExit?: true, maxWaitMs?: 30000 }" };
  }
  const fromSeq = typeof args.fromSeq === "number" ? args.fromSeq : 1;
  const untilExit = args.untilExit === true;
  const maxWaitMs = typeof args.maxWaitMs === "number" ? args.maxWaitMs : 30_000;
  try {
    return await manager.follow(sessionId, { fromSeq, untilExit, maxWaitMs });
  } catch (e) {
    return { error: String(e) };
  }
}

async function cancelImpl(
  args: Record<string, unknown>,
  manager: ITerminalSessionManager,
): Promise<unknown> {
  const sessionId = args.sessionId as string | undefined;
  if (!sessionId || typeof sessionId !== "string") {
    return { error: "Missing sessionId. Example: { sessionId: 'uuid' }" };
  }
  await manager.cancel(sessionId);
  const info = manager.get(sessionId);
  return {
    ok: true,
    sessionId,
    finalStatus: info?.status ?? "killed",
  };
}

export const terminalExecuteSchema = {
  type: "object",
  properties: {
    command: { type: "string", description: "Shell command to run (e.g. 'npm run build')" },
    timeoutMs: { type: "number", description: "Max wait in ms (default 60000)" },
    waitMode: { type: "string", enum: ["until-exit", "until-timeout", "detached"] },
    maxWaitMs: { type: "number", description: "0 means no proactive timeout" },
    stream: { type: "boolean", description: "Include chunks array in response" },
    cwd: { type: "string", description: "Working directory" },
  },
  required: ["command"],
} as const;

export const terminalListSchema = {
  type: "object",
  properties: {},
} as const;

export const terminalRespondSchema = {
  type: "object",
  properties: {
    sessionId: { type: "string", description: "Terminal session ID" },
    input: { type: "string", description: "Line to send to stdin" },
  },
  required: ["sessionId", "input"],
} as const;

export const terminalFollowSchema = {
  type: "object",
  properties: {
    sessionId: { type: "string", description: "Terminal session ID" },
    fromSeq: { type: "number", description: "Read chunks from this sequence (inclusive)" },
    untilExit: { type: "boolean", description: "Wait until process exits" },
    maxWaitMs: { type: "number", description: "Max wait time in milliseconds" },
  },
  required: ["sessionId"],
} as const;
