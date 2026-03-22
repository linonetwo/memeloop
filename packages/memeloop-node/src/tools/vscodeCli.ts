/**
 * VSCode CLI tools: open file/folder, run code --cli, list extensions (diagnostics via runCli).
 */

import { spawn } from "node:child_process";
import type { IToolRegistry } from "memeloop";

const VSCODE_OPEN_ID = "vscode.open";
const VSCODE_OPEN_FOLDER_ID = "vscode.openFolder";
const VSCODE_RUN_CLI_ID = "vscode.runCli";
const VSCODE_LIST_EXT_ID = "vscode.listExtensions";

function runCode(args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn("code", args, { shell: true });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    const t = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ stdout, stderr, code: null });
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(t);
      resolve({ stdout, stderr, code });
    });
    proc.on("error", (err) => {
      clearTimeout(t);
      resolve({ stdout, stderr: err.message, code: -1 });
    });
  });
}

export function registerVscodeTools(registry: IToolRegistry): void {
  registry.registerTool(VSCODE_OPEN_ID, async (args: Record<string, unknown>) => {
    const path = args.path as string | undefined;
    if (!path || typeof path !== "string") {
      return { error: "Missing 'path'. Example: { path: 'src/index.ts' }" };
    }
    const result = await runCode(["--reuse-window", path]);
    return { path, ...result };
  });
  registry.registerTool(VSCODE_OPEN_FOLDER_ID, async (args: Record<string, unknown>) => {
    const path = args.path as string | undefined;
    if (!path || typeof path !== "string") {
      return { error: "Missing 'path'. Example: { path: '/projects/myapp' }" };
    }
    const result = await runCode(["--reuse-window", path]);
    return { path, ...result };
  });
  registry.registerTool(VSCODE_RUN_CLI_ID, async (args: Record<string, unknown>) => {
    const cmd = args.command as string | undefined;
    const cmdArgs = (args.args as string[]) ?? [];
    if (!cmd || typeof cmd !== "string") {
      return { error: "Missing 'command'. Example: { command: 'workbench.action.problems.focus', args?: [] }" };
    }
    const allArgs = ["--cli", cmd, ...cmdArgs];
    const result = await runCode(allArgs);
    return { command: cmd, ...result };
  });
  registry.registerTool(VSCODE_LIST_EXT_ID, async () => {
    const result = await runCode(["--list-extensions"]);
    const list = result.stdout.trim() ? result.stdout.trim().split(/\r?\n/) : [];
    return { extensions: list, ...result };
  });
}
