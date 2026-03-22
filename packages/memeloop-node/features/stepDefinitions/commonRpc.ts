import { Then, When } from "@cucumber/cucumber";

import type { NodeWorld } from "./world.js";

When(
  'I call {string} on peer {string} from {string}',
  async function (this: NodeWorld, method: string, remoteId: string, localId: string) {
    const mgr = this.getOrCreatePeerManager(localId);
    const result = await mgr.sendRpcToNode(remoteId, method, {});
    (this as any).lastRpcResult = result;
  },
);

When(
  'I call {string} on peer {string} from {string} with:',
  async function (
    this: NodeWorld,
    method: string,
    remoteId: string,
    localId: string,
    table: { rowsHash(): Record<string, string> },
  ) {
    const mgr = this.getOrCreatePeerManager(localId);
    const params = table.rowsHash();
    const result = await mgr.sendRpcToNode(remoteId, method, params);
    // 暂存最近一次通用调用结果，供后续 Then 步骤断言。
    (this as any).lastRpcResult = result;
  },
);

Then(
  'the RPC result should have property {string} containing {string}',
  function (this: NodeWorld, prop: string, expected: string) {
    const result = (this as any).lastRpcResult;
    if (!result || typeof result !== "object") {
      throw new Error(`No lastRpcResult to assert. Got: ${JSON.stringify(result)}`);
    }

    const parts = prop.split(".").filter(Boolean);
    let value: unknown = result as unknown;
    for (const p of parts) {
      if (value && typeof value === "object" && p in (value as any)) {
        value = (value as any)[p];
      } else {
        value = undefined;
        break;
      }
    }

    if (Array.isArray(value)) {
      const matches = value.some((v) => typeof v === "string" && v === expected);
      if (!matches) {
        throw new Error(`Expected property ${prop} to contain "${expected}", got: ${JSON.stringify(value)}`);
      }
      return;
    }

    const str = typeof value === "string" ? value : value === undefined ? "" : String(value);
    if (!str.includes(expected)) {
      throw new Error(`Expected property ${prop} to contain "${expected}", got: ${JSON.stringify(value)}`);
    }
  },
);

Then(
  'calling {string} on peer {string} from {string} should return at least 1 session',
  async function (this: NodeWorld, method: string, remoteId: string, localId: string) {
    const mgr = this.getOrCreatePeerManager(localId);
    const result = (await mgr.sendRpcToNode(remoteId, method, {})) as { sessions?: unknown[] };
    const list = result.sessions ?? [];
    if (!Array.isArray(list) || list.length < 1) {
      throw new Error(`Expected at least 1 session, got: ${JSON.stringify(result)}`);
    }
  },
);

Then(
  'the RPC result content should contain {string}',
  function (this: NodeWorld, expected: string) {
    const result = (this as any).lastRpcResult;
    if (!result || typeof result !== "object") {
      throw new Error(`No lastRpcResult to assert. Got: ${JSON.stringify(result)}`);
    }
    const content = (result as any).content;
    if (typeof content !== "string" || !content.includes(expected)) {
      throw new Error(
        `Expected content to contain "${expected}", got: ${JSON.stringify(content)}`,
      );
    }
  },
);

Then(
  'the RPC result should include an MCP server named {string}',
  function (this: NodeWorld, serverName: string) {
    const result = (this as any).lastRpcResult;
    if (!result || typeof result !== "object") {
      throw new Error(`No lastRpcResult to assert. Got: ${JSON.stringify(result)}`);
    }
    const servers = (result as any).servers;
    if (!Array.isArray(servers)) {
      throw new Error(`Expected result.servers to be an array, got: ${JSON.stringify(servers)}`);
    }
    const found = servers.some((s) => s && typeof s === "object" && s.name === serverName);
    if (!found) {
      throw new Error(
        `Expected an MCP server named ${serverName}, but got: ${JSON.stringify(
          servers.map((s: any) => s?.name),
        )}`,
      );
    }
  },
);

Then(
  'the RPC result boolean property {string} should be {string}',
  function (this: NodeWorld, prop: string, expected: string) {
    const result = (this as any).lastRpcResult;
    if (!result || typeof result !== "object") {
      throw new Error(`No lastRpcResult to assert. Got: ${JSON.stringify(result)}`);
    }

    const parts = prop.split(".").filter(Boolean);
    let value: unknown = result as unknown;
    for (const p of parts) {
      if (value && typeof value === "object" && p in (value as any)) {
        value = (value as any)[p];
      } else {
        value = undefined;
        break;
      }
    }

    const expectedBool = expected === "true";
    if (typeof value !== "boolean") {
      throw new Error(`Expected ${prop} to be boolean, got: ${JSON.stringify(value)}`);
    }
    if (value !== expectedBool) {
      throw new Error(`Expected ${prop}=${expectedBool}, got: ${value}`);
    }
  },
);

