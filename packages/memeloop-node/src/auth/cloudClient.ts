/**
 * Cloud connection: OTP register -> nodeSecret; nodeSecret -> JWT; register node; heartbeat.
 */

import type { ConnectivityManager } from "memeloop";

export interface CloudRegisterOtpResult {
  nodeId: string;
  nodeSecret: string;
}

export interface CloudJwtResult {
  accessToken: string;
  expiresIn?: number;
}

export interface NodeRegistrationPayload {
  nodeId: string;
  name?: string;
  capabilities?: { tools?: string[]; hasWiki?: boolean };
  publicIP?: string;
  frpAddress?: string;
  port?: number;
}

export class CloudClient {
  constructor(private baseUrl: string) {}

  private async post<T>(path: string, body: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Cloud API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async put<T>(path: string, body: unknown, token: string): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Cloud API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  /** OTP register: returns nodeId + nodeSecret. */
  async registerWithOtp(otp: string): Promise<CloudRegisterOtpResult> {
    return this.post<CloudRegisterOtpResult>("/api/nodes/register", { otp });
  }

  /** Exchange nodeSecret for JWT. */
  async getJwt(nodeId: string, nodeSecret: string): Promise<CloudJwtResult> {
    return this.post<CloudJwtResult>("/api/nodes/token", { nodeId, nodeSecret });
  }

  /** Register or update node (address, capabilities). */
  async registerNode(payload: NodeRegistrationPayload, jwt: string): Promise<{ ok: boolean }> {
    return this.put<{ ok: boolean }>(`/api/nodes/${payload.nodeId}`, payload, jwt);
  }

  /** Heartbeat to keep node online. */
  async heartbeat(nodeId: string, jwt: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(`/api/nodes/${nodeId}/heartbeat`, {}, jwt);
  }
}

/** Build registration payload from connectivity + nodeId + name. */
export function buildRegistrationPayload(
  nodeId: string,
  port: number,
  name?: string,
  connectivity?: ConnectivityManager | null,
): NodeRegistrationPayload {
  const payload: NodeRegistrationPayload = { nodeId, port, name };
  if (connectivity) {
    const advertised = connectivity.getAdvertisedAddress();
    if (advertised?.type === "publicIP") payload.publicIP = advertised.address.split(":")[0];
    if (advertised?.type === "frp") payload.frpAddress = advertised.address;
  }
  payload.capabilities = { tools: [], hasWiki: true };
  return payload;
}
