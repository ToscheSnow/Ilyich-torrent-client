import type { PeerLocation } from "../types/tracker";

export function parseCompactPeers(peers: Uint8Array): PeerLocation[] {
  const result = [];

  for (let i = 0; i < peers.length; i += 6) {
    const ip = [peers[i], peers[i + 1], peers[i + 2], peers[i + 3]].join(".");

    const port = (peers[i + 4]! << 8) | peers[i + 5]!;

    result.push({ ip, port });
  }

  return result;
}
