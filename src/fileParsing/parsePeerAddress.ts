import type { PeerAddress } from "../peers/PeerManager";

export function parsePeerAddress(peers: Uint8Array): PeerAddress[] {
  const result = [];

  for (let i = 0; i < peers.length; i += 6) {
    const host = [peers[i], peers[i + 1], peers[i + 2], peers[i + 3]].join(".");
    const port = (peers[i + 4]! << 8) | peers[i + 5]!;

    result.push({ host, port });
  }

  return result;
}

export function parseCompactIPv6Peers(peers: Uint8Array): PeerAddress[] {
  if (peers.length % 18 !== 0) {
    throw new Error("Invalid compact IPv6 peers length");
  }

  const buf = Buffer.from(peers.buffer, peers.byteOffset, peers.byteLength);

  const result: PeerAddress[] = [];

  for (let offset = 0; offset < buf.length; offset += 18) {
    const groups: string[] = [];

    for (let i = 0; i < 16; i += 2) {
      groups.push(buf.readUInt16BE(offset + i).toString(16));
    }

    const host = groups.join(":");
    const port = buf.readUInt16BE(offset + 16);

    if (port === 0) continue;

    result.push({ host, port });
  }

  return result;
}
