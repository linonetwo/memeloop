/**
 * Terminal tools for Agent: execute (start and wait/timeout), list sessions, respond (stdin).
 * Register with node ToolRegistry and pass ITerminalSessionManager.
 */

import type { IToolRegistry } from "memeloop";
import type { ITerminalSessionManager } from "../terminal/index.js";

const EXECUTE_ID = "terminal.execute";
const LIST_ID = "terminal.list";
const RESPOND_ID = "terminal.respond";

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
}

async function executeImpl(
  args: Record<string, unknown>,
  manager: ITerminalSessionManager,
): Promise<unknown> {
  const command = args.command as string | undefined;
  const timeoutMs = (args.timeoutMs as number) ?? 60_000;
  const cwd = args.cwd as string | undefined;

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

  const chunks: { stream: string; data: string }[] = [];
  const unsub = manager.onOutput((chunk) => {
    if (chunk.sessionId === sessionId) {
      chunks.push({ stream: chunk.stream, data: chunk.data });
    }
  });

  const start = Date.now();
  for (;;) {
    const info = manager.get(sessionId);
    if (info?.status !== "running" || Date.now() - start >= timeoutMs) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  unsub();

  const info = manager.get(sessionId);
  const stdout = chunks.filter((c) => c.stream === "stdout").map((c) => c.data).join("");
  const stderr = chunks.filter((c) => c.stream === "stderr").map((c) => c.data).join("");
  const timedOut = info?.status === "running";

  if (timedOut) {
    await manager.cancel(sessionId);
  }

  return {
    sessionId,
    status: info?.status ?? "unknown",
    exitCode: info?.exitCode ?? null,
    timedOut,
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

export const terminalExecuteSchema = {
  type: "object",
  properties: {
    command: { type: "string", description: "Shell command to run (e.g. 'npm run build')" },
    timeoutMs: { type: "number", description: "Max wait in ms (default 60000)" },
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
