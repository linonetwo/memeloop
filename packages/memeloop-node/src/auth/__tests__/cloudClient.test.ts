import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi, afterEach } from "vitest";

import { buildRegistrationPayload, CloudClient } from "../cloudClient.js";

describe("CloudClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registerWithOtp posts to register endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodeId: "n1", nodeSecret: "s1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new CloudClient("https://cloud.example.com/");
    const r = await client.registerWithOtp("123456");
    expect(r.nodeId).toBe("n1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloud.example.com/api/nodes/register",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("registerWithOtp forwards optional public keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodeId: "n1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new CloudClient("https://cloud.example.com/");
    await client.registerWithOtp("123456", { x25519PublicKey: "x", ed25519PublicKey: "e" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloud.example.com/api/nodes/register",
      expect.objectContaining({
        body: JSON.stringify({ otp: "123456", x25519PublicKey: "x", ed25519PublicKey: "e" }),
      }),
    );
  });

  it("getJwt throws on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new CloudClient("https://cloud.example.com");
    await expect(client.getJwt("n1", "bad")).rejects.toThrow("Cloud API 401");
  });

  it("registerNode uses PUT and bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new CloudClient("https://cloud.example.com");
    await client.registerNode({ nodeId: "n1", port: 38472 }, "jwt-x");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloud.example.com/api/nodes/n1",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ Authorization: "Bearer jwt-x" }),
      }),
    );
  });

  it("getJwtByChallenge requests challenge then verifies signature", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const privateKeyB64 = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64url");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ challenge: Buffer.from("abc").toString("base64url") }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: "jwt1" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = new CloudClient("https://cloud.example.com");
    const result = await client.getJwtByChallenge("n1", privateKeyB64);
    expect(result.accessToken).toBe("jwt1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://cloud.example.com/api/nodes/auth/verify",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("buildRegistrationPayload maps connectivity addresses", () => {
    const payloadPublic = buildRegistrationPayload(
      "n1",
      38472,
      "node1",
      {
        getAdvertisedAddress: () => ({ type: "publicIP", address: "1.2.3.4:38472" }),
      } as any,
    );
    expect(payloadPublic.publicIP).toBe("1.2.3.4");
    expect(payloadPublic.capabilities?.hasWiki).toBe(true);

    const payloadFrp = buildRegistrationPayload(
      "n2",
      38472,
      "node2",
      {
        getAdvertisedAddress: () => ({ type: "frp", address: "x.nodes.memeloop.com:20001" }),
      } as any,
    );
    expect(payloadFrp.frpAddress).toBe("x.nodes.memeloop.com:20001");
  });
});
