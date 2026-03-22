import type { DataTable } from "@cucumber/cucumber";

import { Given, Then, When } from "@cucumber/cucumber";

import type { NodeWorld } from "./world.js";

function parseArgs(argsText: string): string[] {
  // simple whitespace split (we avoid JS "=>" to not break Windows shells)
  return argsText
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

Given("a running terminal session with:", async function (this: NodeWorld, table: DataTable) {
  const rows = table.hashes();
  const row = rows[0] ?? {};
  const command = row.command as string | undefined;
  const argsText = row.args as string | undefined;
  if (!command || typeof command !== "string") {
    throw new Error("Terminal session requires 'command' in table");
  }

  const args = argsText ? parseArgs(argsText) : undefined;
  const { sessionId } = await this.terminalManager.start({
    command,
    args,
    promptPatterns: [{ name: "generic", regex: /[?%]\s*$|>\s*$|:\s*$/m }],
    idleTimeoutMs: 5_000,
  });
  this.lastTerminalSessionId = sessionId;
});

When(
  'I cancel the terminal session on peer {string} from {string}',
  async function (this: NodeWorld, remoteId: string, localId: string) {
    const sessionId = this.lastTerminalSessionId;
    if (!sessionId) throw new Error("No terminal session id stored in world");
    const mgr = this.getOrCreatePeerManager(localId);
    await mgr.sendRpcToNode(remoteId, "memeloop.terminal.cancel", { sessionId });
  },
);

Then(
  'the terminal session status should not be "running"',
  function (this: NodeWorld) {
    const sessionId = this.lastTerminalSessionId;
    if (!sessionId) throw new Error("No terminal session id stored in world");
    const info = this.terminalManager.get(sessionId);
    const status = info?.status ?? "unknown";
    if (status === "running") {
      throw new Error(`Expected terminal session to not be running, got status=${status}`);
    }
  },
);

