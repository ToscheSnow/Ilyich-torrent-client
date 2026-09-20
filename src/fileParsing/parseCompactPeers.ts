import type { PeerAddress } from "../peers/PeerManager";

export function parseCompactPeers(peers: Uint8Array): PeerAddress[] {
  const result = [];
  

  for (let i = 0; i < peers.length; i += 6) {
    const host = [peers[i], peers[i + 1], peers[i + 2], peers[i + 3]].join(".");

    const port = (peers[i + 4]! << 8) | peers[i + 5]!;

    result.push({ host, port });
  }

  return result;
}
