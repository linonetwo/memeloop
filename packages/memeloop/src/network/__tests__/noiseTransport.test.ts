import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import { decryptNoiseFrame, encryptNoiseFrame } from "../noiseTransport.js";

describe("noiseTransport", () => {
  it("round-trips a payload with monotonic counter", () => {
    const key = randomBytes(32);
    const plain = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), "utf8");
    const frame = encryptNoiseFrame(key, 1n, plain);
    const { counter, plaintext, rest } = decryptNoiseFrame(key, frame);
    expect(counter).toBe(1n);
    expect(plaintext.equals(plain)).toBe(true);
    expect(rest.length).toBe(0);
  });
});
