/**
 * Post-handshake framing for Noise + ChaCha20-Poly1305 (plan §7.5.5).
 * Wire format: `[4-byte BE length][8-byte BE counter][ciphertext + 16-byte Poly1305 tag]`.
 * IV = 12 bytes: 4 zero + 8-byte counter (big-endian). Handshake / key derivation is done elsewhere.
 */

import { createCipheriv, createDecipheriv } from "node:crypto";

/** ChaCha20-Poly1305 AEAD（Node crypto 支持；类型定义未必列入 CipherGCMTypes）。 */
const ALGO = "chacha20-poly1305" as const;
const TAG_LENGTH = 16;
const COUNTER_BYTES = 8;

function ivFromCounter(counter: bigint): Buffer {
  const iv = Buffer.alloc(12, 0);
  iv.writeBigUInt64BE(counter, 4);
  return iv;
}

export function encryptNoiseFrame(key: Buffer, counter: bigint, plaintext: Buffer): Buffer {
  if (key.length !== 32) throw new Error("noiseTransport: key must be 32 bytes");
  const iv = ivFromCounter(counter);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const counterBe = Buffer.alloc(COUNTER_BYTES);
  counterBe.writeBigUInt64BE(counter, 0);
  const body = Buffer.concat([counterBe, enc, tag]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** 握手完成后封装 JSON-RPC：发送用 sendKey，接收用 recvKey（与 {@link getNoiseXxPeerCryptoMaterial} 一致）。 */
export class NoiseJsonRpcCodec {
  private sendCounter = 0n;

  constructor(
    private readonly sendKey: Buffer,
    private readonly recvKey: Buffer,
  ) {}

  encrypt(utf8Json: string): Buffer {
    const frame = encryptNoiseFrame(this.sendKey, this.sendCounter, Buffer.from(utf8Json, "utf8"));
    this.sendCounter += 1n;
    return frame;
  }

  decrypt(frame: Buffer): string {
    const { plaintext } = decryptNoiseFrame(this.recvKey, frame);
    return plaintext.toString("utf8");
  }
}

export function decryptNoiseFrame(key: Buffer, frame: Buffer): { counter: bigint; plaintext: Buffer; rest: Buffer } {
  if (key.length !== 32) throw new Error("noiseTransport: key must be 32 bytes");
  if (frame.length < 4 + COUNTER_BYTES + TAG_LENGTH) throw new Error("noiseTransport: frame too short");
  const len = frame.readUInt32BE(0);
  if (len < COUNTER_BYTES + TAG_LENGTH || frame.length < 4 + len) {
    throw new Error("noiseTransport: invalid frame length");
  }
  const body = frame.subarray(4, 4 + len);
  const counter = body.subarray(0, COUNTER_BYTES).readBigUInt64BE(0);
  const iv = ivFromCounter(counter);
  const ct = body.subarray(COUNTER_BYTES, body.length - TAG_LENGTH);
  const tag = body.subarray(body.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return { counter, plaintext, rest: frame.subarray(4 + len) };
}
