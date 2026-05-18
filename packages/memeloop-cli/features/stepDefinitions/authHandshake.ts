import { Given, Then, When } from "@cucumber/cucumber";

import fs from "node:fs";

import { buildAuthHandshakeMessage } from "memeloop";
import {
  getDefaultConfigPath,
  loadConfig,
  saveConfig,
  type NodeConfig,
} from "../../src/config";
import type { NodeWorld } from "./world.js";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebSocket = require("ws") as { new (url: string): any; OPEN: number };

function waitForJsonRpcMessage(ws: { once: (ev: string, fn: (d: Buffer) => void) => void }): Promise<{
  id?: number | null;
  error?: { code?: number; message?: string };
  result?: unknown;
}> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for WebSocket message")), 10_000);
    ws.once("message", (data: Buffer) => {
      clearTimeout(t);
      try {
        resolve(JSON.parse(data.toString()) as ReturnType<typeof JSON.parse>);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

Given("strict LAN PIN {string}", function (this: NodeWorld, pin: string) {
  this.strictLanPin = pin;
  const configPath = this.authConfigPath ?? getDefaultConfigPath(process.cwd());
  const cfg = loadConfig(configPath);
  cfg.auth = {
    ...cfg.auth,
    ws: { enabled: true, mode: "lan-pin", pin },
    // Reset state per scenario to avoid cross-scenario cooldown contamination.
    lanPinState: { failCount: 0, nextAllowedAt: 0 },
  };
  saveConfig(cfg, configPath);
});

Given("the client handshake credential is {string}", function (this: NodeWorld, cred: string) {
  this.handshakeCredential = cred;
});

When("a raw WebSocket client connects to {string}", async function (this: NodeWorld, nodeId: string) {
  const target = this.nodes.get(nodeId);
  if (!target) throw new Error(`Node not started: ${nodeId}`);
  if (this.rawWs) {
    try {
      this.rawWs.close();
    } catch {
      /* ignore */
    }
  }
  const ws = new WebSocket(`ws://127.0.0.1:${target.port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err: Error) => reject(err));
  });
  this.rawWs = ws;
});

When("the client sends auth handshake with PIN {string}", async function (this: NodeWorld, pin: string) {
  const ws = this.rawWs as unknown as { send(s: string): void } | undefined;
  if (!ws) throw new Error("raw WebSocket not connected");
  const payload = buildAuthHandshakeMessage({
    nodeId: "raw-test-client",
    authType: "pin",
    credential: pin,
  });
  ws.send(payload);
});

When("I wait for one JSON-RPC message on raw websocket", async function (this: NodeWorld) {
  const ws = this.rawWs as unknown as { once: typeof WebSocket.prototype.once } | undefined;
  if (!ws) throw new Error("raw WebSocket not connected");
  await waitForJsonRpcMessage(ws as any);
});

When("I wait {int} ms", async function (ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

When("I wait until LAN PIN backoff window passes in config", async function (this: NodeWorld) {
  const configPath = this.authConfigPath ?? getDefaultConfigPath(process.cwd());
  const cfg = loadConfig(configPath);
  const nextAllowedAt = cfg.auth?.lanPinState?.nextAllowedAt ?? 0;
  const now = Date.now();
  const waitMs = Math.max(0, nextAllowedAt - now + 150);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
});

When("I clear LAN PIN cooldown in config for next attempt", function (this: NodeWorld) {
  const configPath = this.authConfigPath ?? getDefaultConfigPath(process.cwd());
  const cfg = loadConfig(configPath);
  const failCount = cfg.auth?.lanPinState?.failCount ?? 0;
  cfg.auth = {
    ...cfg.auth,
    lanPinState: { failCount, nextAllowedAt: 0 },
  };
  saveConfig(cfg, configPath);
});

When("a clean auth state in config", function (this: NodeWorld) {
  const configPath = getDefaultConfigPath(process.cwd());
  let cfg: NodeConfig = {};
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    cfg = JSON.parse(JSON.stringify(require("js-yaml").load(raw))) as NodeConfig;
  } catch {
    cfg = {};
  }
  if (!cfg.auth) cfg.auth = {};
  cfg.auth.lanPinState = { failCount: 0, nextAllowedAt: 0 };
  const dumped = require("js-yaml").dump(cfg, { indent: 2 });
  fs.writeFileSync(configPath, dumped, "utf-8");
});

Then(
  'the client should receive JSON-RPC result nodeId {string}',
  async function (this: NodeWorld, expectedNodeId: string) {
    const ws = this.rawWs as unknown as { once: typeof WebSocket.prototype.once } | undefined;
    if (!ws) throw new Error("raw WebSocket not connected");
    const msg = await waitForJsonRpcMessage(ws as any);
    if (msg.error) {
      throw new Error(`Expected JSON-RPC result, got error: ${JSON.stringify(msg.error)}`);
    }
    const result = msg.result as any;
    const nodeId = result?.nodeId;
    if (nodeId !== expectedNodeId) {
      throw new Error(`Expected nodeId=${expectedNodeId}, got ${nodeId}`);
    }
  },
);

When(
  'the client sends JSON-RPC method {string} with id {int} and empty params',
  async function (this: NodeWorld, method: string, id: number) {
    const ws = this.rawWs as unknown as { send(s: string): void } | undefined;
    if (!ws) throw new Error("raw WebSocket not connected");
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: {},
      }),
    );
  },
);

Then("the client should receive JSON-RPC error code {int}", async function (this: NodeWorld, code: number) {
  const ws = this.rawWs as unknown as { once: typeof WebSocket.prototype.once } | undefined;
  if (!ws) throw new Error("raw WebSocket not connected");
  const msg = await waitForJsonRpcMessage(ws as any);
  if (!msg.error) {
    throw new Error(`Expected JSON-RPC error, got: ${JSON.stringify(msg)}`);
  }
  if (msg.error.code !== code) {
    throw new Error(`Expected error code ${code}, got ${msg.error.code}: ${msg.error.message}`);
  }
});

Then("the LAN PIN state in config should have failCount at least {int}", function (minFail: number) {
  const configPath = getDefaultConfigPath(process.cwd());
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const cfg = require("js-yaml").load(raw) as NodeConfig;
  const failCount = cfg.auth?.lanPinState?.failCount ?? 0;
  if (failCount < minFail) {
    throw new Error(`Expected failCount >= ${minFail}, got ${failCount}`);
  }
});

Then("the LAN PIN nextAllowedAt in config should be in the future", function () {
  const configPath = getDefaultConfigPath(process.cwd());
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const cfg = require("js-yaml").load(raw) as NodeConfig;
  const nextAllowedAt = cfg.auth?.lanPinState?.nextAllowedAt ?? 0;
  if (!nextAllowedAt || nextAllowedAt <= Date.now()) {
    throw new Error(`Expected nextAllowedAt to be in the future, got ${nextAllowedAt}`);
  }
});
