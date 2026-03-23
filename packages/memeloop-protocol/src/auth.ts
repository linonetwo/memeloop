export type AuthType = "pairingToken" | "jwt" | "pin";

export interface AuthHandshakeParams {
  nodeId: string;
  authType: AuthType;
  credential: string;
}

/** 服务端发起的配对/挑战（含 PIN 场景下的请求方与过期时间）。 */
export interface AuthChallenge {
  pin: string;
  requestingNodeId: string;
  expiresAt: number;
}

export interface PairingRequest {
  pin: string;
  requestingNodeId?: string;
  expiresAt?: number;
}

export interface PairingToken {
  token: string;
  issuedAt: number;
  expiresAt?: number;
}

