import { describe, expect, it } from "vitest";

import { decodeAttachmentBlobRpc } from "../attachmentRpcCodec.js";

describe("decodeAttachmentBlobRpc", () => {
  it("decodes successful RPC payload", () => {
    const raw = Buffer.from([9, 9, 9]).toString("base64");
    const d = decodeAttachmentBlobRpc({
      found: true,
      dataBase64: raw,
      filename: "x.bin",
      mimeType: "application/octet-stream",
      size: 3,
    });
    expect(d).not.toBeNull();
    expect(d!.filename).toBe("x.bin");
    expect([...d!.data]).toEqual([9, 9, 9]);
  });

  it("returns null on missing blob", () => {
    expect(decodeAttachmentBlobRpc({ found: false })).toBeNull();
    expect(decodeAttachmentBlobRpc({ found: true, dataBase64: "" })).toBeNull();
  });
});
