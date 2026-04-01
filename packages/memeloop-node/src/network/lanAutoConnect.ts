import type { MemeloopServiceInfo } from "memeloop";

export interface PeerConnector {
  addPeerByUrl(wsUrl: string): Promise<{ nodeId: string }>;
}

export function buildDiscoveredPeerWsUrl(
  svc: MemeloopServiceInfo,
): string | null {
  const host = svc.host?.trim();
  if (!host || !svc.port) return null;
  const wsPath = svc.wsPath?.trim() || "/";
  return `ws://${host}:${svc.port}${wsPath.startsWith("/") ? wsPath : `/${wsPath}`}`;
}

export async function autoConnectDiscoveredPeer(
  svc: MemeloopServiceInfo,
  localNodeId: string,
  peerConnector: PeerConnector,
): Promise<boolean> {
  const discoveredNodeId = svc.nodeId?.trim();
  if (discoveredNodeId && discoveredNodeId === localNodeId) return false;
  const wsUrl = buildDiscoveredPeerWsUrl(svc);
  if (!wsUrl) return false;
  try {
    await peerConnector.addPeerByUrl(wsUrl);
    return true;
  } catch {
    return false;
  }
}
