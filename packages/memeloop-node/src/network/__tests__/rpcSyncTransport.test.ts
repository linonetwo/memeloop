import { describe, expect, it, vi } from "vitest";

import { createPeerRpcSyncTransport } from "../rpcSyncTransport";

describe("createPeerRpcSyncTransport", () => {
  it("maps exchange/pull RPC methods and falls back to empty collections", async () => {
    const sendRpc = vi.fn(async (_nodeId: string, method: string) => {
      if (method === "memeloop.sync.exchangeVersionVector") return { remoteVersion: { a: 1 }, missingForRemote: [{ id: "c1" }] };
      if (method === "memeloop.sync.pullMissingMetadata") return { metas: [{ id: "m1" }] };
      if (method === "memeloop.sync.pullMissingMessages") return { messages: [{ id: "msg1" }] };
      return {};
    });
    const transport = createPeerRpcSyncTransport(sendRpc);

    await expect(transport.exchangeVersionVector("n1", { me: 2 })).resolves.toEqual({
      remoteVersion: { a: 1 },
      missingForRemote: [{ id: "c1" }],
    });
    await expect(transport.pullMissingMetadata("n1", { me: 1 })).resolves.toEqual([{ id: "m1" }]);
    await expect(transport.pullMissingMessages("n1", "c1", [])).resolves.toEqual([{ id: "msg1" }]);
  });

  it("covers empty/invalid RPC results for all transports", async () => {
    const sendRpc = vi.fn(async (_nodeId: string, method: string) => {
      if (method === "memeloop.sync.exchangeVersionVector") return { missingForRemote: undefined };
      if (method === "memeloop.sync.pullMissingMetadata") return {};
      if (method === "memeloop.sync.pullMissingMessages") return { messages: undefined };
      if (method === "memeloop.storage.getAttachmentBlob") return { found: true, dataBase64: 123 as any };
      return {};
    });

    const transport = createPeerRpcSyncTransport(sendRpc);

    // exchangeVersionVector: missing remoteVersion => {}
    await expect(transport.exchangeVersionVector("n1", { me: 2 })).resolves.toEqual({
      remoteVersion: {},
      missingForRemote: [],
    });

    await expect(transport.pullMissingMetadata("n1", { me: 1 })).resolves.toEqual([]);
    await expect(transport.pullMissingMessages("n1", "c1", [])).resolves.toEqual([]);
    await expect(transport.pullAttachmentBlob("n2", "h1")).resolves.toBeNull();
  });

  it("fills defaults when attachment blob fields are missing", async () => {
    const sendRpc = vi.fn(async (_nodeId: string, method: string) => {
      if (method !== "memeloop.storage.getAttachmentBlob") return {};
      return {
        found: true,
        dataBase64: Buffer.from("hello").toString("base64"),
        // omit filename/mimeType/size to cover defaults
      };
    });

    const transport = createPeerRpcSyncTransport(sendRpc);
    const blob = await transport.pullAttachmentBlob("n2", "h1");
    expect(blob).not.toBeNull();
    expect(blob?.filename).toBe("attachment");
    expect(blob?.mimeType).toBe("application/octet-stream");
    expect(blob?.size).toBe(5);
  });

  it("decodes attachment payload and returns null when missing", async () => {
    const sendRpc = vi
      .fn()
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({
        found: true,
        dataBase64: Buffer.from("abc").toString("base64"),
        filename: "a.txt",
        mimeType: "text/plain",
        size: 3,
      });

    const transport = createPeerRpcSyncTransport(sendRpc);

    await expect(transport.pullAttachmentBlob("n2", "h1")).resolves.toBeNull();
    await expect(transport.pullAttachmentBlob("n2", "h2")).resolves.toMatchObject({
      filename: "a.txt",
      mimeType: "text/plain",
      size: 3,
    });
    const blob = await transport.pullAttachmentBlob("n2", "h3");
    expect(blob).toBeNull();
  });
});
