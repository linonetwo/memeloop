/**
 * Demo tools: Start development servers and capture their output
 * Inspired by Cursor 3's demo generation for result verification
 */

import { defineTool } from "memeloop";
import type { IToolRegistry } from "memeloop";
import { spawn, type ChildProcess } from "node:child_process";
import { takeScreenshot, type ScreenshotResult } from "./screenshot.js";

interface DemoServer {
  process: ChildProcess;
  port: number;
  url: string;
  startTime: number;
}

// Track running demo servers for cleanup
const runningServers = new Map<string, DemoServer>();

export interface DemoStartParams {
  command: string;
  cwd: string;
  port?: number;
  env?: Record<string, string>;
  waitForReady?: number;
}

export interface DemoStartResult {
  success: boolean;
  url?: string;
  port?: number;
  serverId?: string;
  error?: string;
  output?: string;
}

/**
 * Wait for a port to be ready
 */
async function waitForPort(port: number, timeoutMs: number = 30000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok || response.status < 500) {
        return true;
      }
    } catch {
      // Port not ready yet, continue waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

/**
 * Start a development server
 */
export async function startDemoServer(params: DemoStartParams): Promise<DemoStartResult> {
  try {
    const { command, cwd, port, env, waitForReady = 30000 } = params;

    // Parse command
    const [cmd, ...args] = command.split(" ");

    // Start process
    const childProcess = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
      detached: false,
    });

    const serverId = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    let output = "";
    let detectedPort = port;

    // Capture output to detect port
    childProcess.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;

      // Try to detect port from common patterns
      if (!detectedPort) {
        const portMatch = text.match(/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (portMatch?.[1]) {
          detectedPort = parseInt(portMatch[1], 10);
        }
      }
    });

    childProcess.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    // Wait a bit for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // If port was detected or provided, wait for it to be ready
    if (detectedPort) {
      const ready = await waitForPort(detectedPort, waitForReady);
      if (!ready) {
        childProcess.kill();
        return {
          success: false,
          error: `Server did not become ready on port ${detectedPort} within ${waitForReady}ms`,
          output,
        };
      }
    }

    const finalPort = detectedPort ?? 3000; // Default fallback
    const url = `http://localhost:${finalPort}`;

    // Store server info for cleanup
    runningServers.set(serverId, {
      process: childProcess,
      port: finalPort,
      url,
      startTime: Date.now(),
    });

    return {
      success: true,
      url,
      port: finalPort,
      serverId,
      output: output.slice(-500), // Last 500 chars
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stop a demo server
 */
export async function stopDemoServer(
  serverId: string,
): Promise<{ success: boolean; error?: string }> {
  const server = runningServers.get(serverId);
  if (!server) {
    return { success: false, error: `Server not found: ${serverId}` };
  }

  try {
    server.process.kill();
    runningServers.delete(serverId);
    return { success: true };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Start server and take screenshot
 */
export async function demoScreenshot(params: {
  command: string;
  cwd: string;
  path?: string;
  port?: number;
  waitForReady?: number;
  fullPage?: boolean;
}): Promise<{
  success: boolean;
  url?: string;
  serverId?: string;
  screenshot?: ScreenshotResult;
  error?: string;
}> {
  // Start server
  const startResult = await startDemoServer({
    command: params.command,
    cwd: params.cwd,
    port: params.port,
    waitForReady: params.waitForReady,
  });

  if (!startResult.success || !startResult.url) {
    return {
      success: false,
      error: startResult.error ?? "Failed to start server",
    };
  }

  // Take screenshot
  const screenshotUrl = `${startResult.url}${params.path ?? "/"}`;
  const screenshot = await takeScreenshot({
    url: screenshotUrl,
    fullPage: params.fullPage ?? false,
    timeout: 10000,
  });

  return {
    success: screenshot.success,
    url: startResult.url,
    serverId: startResult.serverId,
    screenshot,
    error: screenshot.success ? undefined : screenshot.error,
  };
}

/**
 * Register demo tools in the tool registry
 */
export function registerDemoTools(registry: IToolRegistry): void {
  // demo.start tool
  const startTool = defineTool({
    name: "demo.start",
    description:
      "Start a development server (e.g., npm run dev, next dev) and return the URL. The server will keep running until explicitly stopped. Useful for testing web applications.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Command to start the server (e.g., 'npm run dev', 'next dev', 'python -m http.server')",
        },
        cwd: {
          type: "string",
          description: "Working directory where the command should run",
        },
        port: {
          type: "number",
          description: "Expected port number (optional, will try to auto-detect)",
        },
        waitForReady: {
          type: "number",
          description:
            "Maximum time to wait for server to be ready in milliseconds (default: 30000)",
        },
      },
      required: ["command", "cwd"],
    },
    async execute(params: unknown) {
      const result = await startDemoServer(params as DemoStartParams);

      if (!result.success) {
        return {
          error: result.error,
          output: result.output,
        };
      }

      return {
        success: true,
        message: `Server started successfully at ${result.url}`,
        url: result.url,
        port: result.port,
        serverId: result.serverId,
        note: `Use demo.stop with serverId="${result.serverId}" to stop the server`,
      };
    },
  });

  // demo.stop tool
  const stopTool = defineTool({
    name: "demo.stop",
    description: "Stop a running demo server started with demo.start",
    parameters: {
      type: "object",
      properties: {
        serverId: {
          type: "string",
          description: "Server ID returned from demo.start",
        },
      },
      required: ["serverId"],
    },
    async execute(params: unknown) {
      const { serverId } = params as { serverId: string };
      const result = await stopDemoServer(serverId);

      if (!result.success) {
        return { error: result.error };
      }

      return {
        success: true,
        message: `Server ${serverId} stopped successfully`,
      };
    },
  });

  // demo.screenshot tool
  const screenshotTool = defineTool({
    name: "demo.screenshot",
    description:
      "Start a development server, wait for it to be ready, and take a screenshot. This is the recommended way to verify web application results. The server will keep running after the screenshot.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to start the server (e.g., 'npm run dev')",
        },
        cwd: {
          type: "string",
          description: "Working directory",
        },
        path: {
          type: "string",
          description: "URL path to screenshot (default: /)",
        },
        port: {
          type: "number",
          description: "Expected port number (optional)",
        },
        fullPage: {
          type: "boolean",
          description: "Capture full scrollable page (default: false)",
        },
        waitForReady: {
          type: "number",
          description: "Max wait time for server in milliseconds (default: 30000)",
        },
      },
      required: ["command", "cwd"],
    },
    async execute(params: unknown) {
      const result = await demoScreenshot(params as Parameters<typeof demoScreenshot>[0]);

      if (!result.success) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment
        return {
          error: result.error,
          suggestion: "Check that the command is correct and the application builds successfully",
        };
      }

      return {
        success: true,
        message: `Demo server started and screenshot captured`,
        url: result.url,
        serverId: result.serverId,
        screenshot: {
          contentHash: result.screenshot?.contentHash,
          imageBase64: result.screenshot?.imageBase64,
          size: result.screenshot?.imageBase64?.length ?? 0,
        },
        note: `Server is still running. Use demo.stop with serverId="${result.serverId}" to stop it`,
      };
    },
  });

  registry.registerTool(startTool.id, startTool.execute);
  registry.registerTool(stopTool.id, stopTool.execute);
  registry.registerTool(screenshotTool.id, screenshotTool.execute);
}

/**
 * Cleanup all running servers (call on process exit)
 */
export function cleanupAllDemoServers(): void {
  for (const [serverId, server] of runningServers.entries()) {
    try {
      server.process.kill();
      runningServers.delete(serverId);
    } catch {
      // Ignore errors during cleanup
    }
  }
}
