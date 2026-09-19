import type { BlockRequest, PeerEvent, TorrentPeer } from "../types/peerTypes";

type RequestKey = `${number}:${number}:${number}`;

function requestKey(r: BlockRequest): RequestKey {
  return `${r.piece}:${r.offset}:${r.length}`;
}


