export type AuthType = "pairingToken" | "jwt" | "pin";

export interface AuthHandshakeParams {
  nodeId: string;
  authType: AuthType;
  credential: string;
}

export interface PairingRequest {
  pin: string;
}

export interface PairingToken {
  token: string;
  issuedAt: number;
  expiresAt?: number;
}

