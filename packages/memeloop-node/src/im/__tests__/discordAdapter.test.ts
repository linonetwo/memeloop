import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyDiscordInteraction } from "../discordAdapter.js";

function rawEd25519PublicKeyHex(publicKey: KeyObject): string {
  const der = publicKey.export({
    type: "spki",
    format: "der",
  }) as Buffer;
  return der.subarray(-32).toString("hex");
}

describe("verifyDiscordInteraction", () => {
  it("returns true for a valid Ed25519 signature over timestamp+body", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const hex = rawEd25519PublicKeyHex(publicKey);
    const body = '{"type":1}';
    const ts = "1700000000";
    const sig = sign(undefined, Buffer.from(ts + body, "utf8"), privateKey);
    const ok = verifyDiscordInteraction(hex, {
      headers: {
        "x-signature-ed25519": sig.toString("hex"),
        "x-signature-timestamp": ts,
      },
      body: Buffer.from(body),
    });
    expect(ok).toBe(true);
  });

  it("returns false when signature does not match public key", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const { privateKey: otherPriv } = generateKeyPairSync("ed25519");
    const hex = rawEd25519PublicKeyHex(publicKey);
    const body = '{"type":1}';
    const ts = "1700000000";
    const sig = sign(undefined, Buffer.from(ts + body, "utf8"), otherPriv);
    expect(
      verifyDiscordInteraction(hex, {
        headers: {
          "x-signature-ed25519": sig.toString("hex"),
          "x-signature-timestamp": ts,
        },
        body: Buffer.from(body),
      }),
    ).toBe(false);
  });

  it("returns false without public key", () => {
    expect(
      verifyDiscordInteraction(undefined, {
        headers: {},
        body: Buffer.from("{}"),
      }),
    ).toBe(false);
  });
});
