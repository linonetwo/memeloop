import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  decryptWecomEncryptPayload,
  parseWecomInboundFromXml,
  verifyWecomPostMsgSignature,
} from "../wecomCrypto.js";

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/** 与官方算法对称：PKCS#7 填充后 AES-256-CBC，IV = key 前 16 字节。 */
function encryptWecomForTest(encodingAesKeyB64: string, xml: string, corpId: string): string {
  const key = Buffer.from(encodingAesKeyB64.trim() + "=", "base64");
  if (key.length !== 32) {
    throw new Error("bad test key length");
  }
  const iv = key.subarray(0, 16);
  const random = randomBytes(16);
  const xmlBuf = Buffer.from(xml, "utf8");
  const content = Buffer.concat([random, u32be(xmlBuf.length), xmlBuf, Buffer.from(corpId, "utf8")]);
  const block = 16;
  const pad = block - (content.length % block) || block;
  const padded = Buffer.concat([content, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

function encodingAesKeyFromRaw32(raw: Buffer): string {
  return raw.toString("base64").replace(/=+$/, "");
}

describe("wecomCrypto", () => {
  const token = "wecomtok";
  const corpId = "ww1234567890";
  const encodingKey = encodingAesKeyFromRaw32(Buffer.alloc(32, 9));

  it("verifyWecomPostMsgSignature matches sorted SHA1", () => {
    const enc = "cipherblob";
    const ts = "1700000000";
    const nonce = "nonce1";
    const arr = [token, ts, nonce, enc].sort().join("");
    const sig = createHash("sha1").update(arr, "utf8").digest("hex");
    expect(verifyWecomPostMsgSignature(token, ts, nonce, enc, sig)).toBe(true);
    expect(verifyWecomPostMsgSignature(token, ts, nonce, enc, "deadbeef")).toBe(false);
  });

  it("decryptWecomEncryptPayload + parseWecomInboundFromXml roundtrip", () => {
    const xml = `<xml><FromUserName><![CDATA[fromU]]></FromUserName><Content><![CDATA[hi wecom]]></Content></xml>`;
    const b64 = encryptWecomForTest(encodingKey, xml, corpId);
    const plain = decryptWecomEncryptPayload(encodingKey, b64, corpId);
    expect(plain).toBe(xml);
    const msg = parseWecomInboundFromXml(plain!, "chan1");
    expect(msg?.text).toBe("hi wecom");
    expect(msg?.imUserId).toBe("fromU");
  });
});
