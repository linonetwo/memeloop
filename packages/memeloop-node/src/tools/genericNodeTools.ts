import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { IToolRegistry } from "memeloop";

const execFileAsync = promisify(execFile);

const todoStore = new Map<string, { id: string; content: string; status: string }>();

export function registerGenericNodeTools(registry: IToolRegistry): void {
  registry.registerTool("git", async (args: Record<string, unknown>) => gitImpl(args));
  registry.registerTool("webFetch", async (args: Record<string, unknown>) => webFetchImpl(args));
  registry.registerTool("todo", async (args: Record<string, unknown>) => todoImpl(args));
  registry.registerTool("summary", async (args: Record<string, unknown>) => summaryImpl(args));
}

async function gitImpl(args: Record<string, unknown>): Promise<unknown> {
  const subcommand = String(args.subcommand ?? "status").trim();
  const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
  const allowed = new Set(["status", "log", "diff", "show", "branch"]);
  if (!allowed.has(subcommand)) {
    return { error: `Unsupported subcommand: ${subcommand}` };
  }
  const { stdout, stderr } = await execFileAsync("git", [subcommand], { cwd });
  return { ok: true, subcommand, stdout, stderr };
}

async function webFetchImpl(args: Record<string, unknown>): Promise<unknown> {
  const url = typeof args.url === "string" ? args.url : "";
  if (!url) return { error: "Missing url" };
  const res = await fetch(url);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function todoImpl(args: Record<string, unknown>): Promise<unknown> {
  const action = String(args.action ?? "list");
  if (action === "list") return { todos: [...todoStore.values()] };
  if (action === "upsert") {
    const id = String(args.id ?? "").trim();
    const content = String(args.content ?? "");
    const status = String(args.status ?? "pending");
    if (!id) return { error: "Missing id" };
    todoStore.set(id, { id, content, status });
    return { ok: true, todo: todoStore.get(id) };
  }
  if (action === "remove") {
    const id = String(args.id ?? "").trim();
    todoStore.delete(id);
    return { ok: true };
  }
  return { error: "Unsupported action" };
}

async function summaryImpl(args: Record<string, unknown>): Promise<unknown> {
  const input = String(args.text ?? "");
  const maxLength = Math.max(32, Math.min(2000, Number(args.maxLength ?? 300)));
  const summary = input.length <= maxLength ? input : `${input.slice(0, maxLength - 3)}...`;
  return { summary, originalLength: input.length };
}
