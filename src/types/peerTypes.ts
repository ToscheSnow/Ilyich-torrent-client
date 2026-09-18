export interface PeerState {
  // i can send
  amChoking: boolean;

  // i want something
  amInterested: boolean;

  // i can not receive
  peerChoking: boolean;

  // they want something
  peerInterested: boolean;
}

export interface BlockRequest {
  piece: number;
  offset: number;
  length: number;
  sentAt: number;
}

export interface TorrentPeer {
  state: PeerState;
  pieces: Set<number>;

  pendingRequests: Map<string, BlockRequest>;
  requestQueue: BlockRequest[];
}

export type PeerEvent =
  | { type: "CHOKE" }
  | { type: "UNCHOKE" }
  | { type: "INTERESTED" }
  | { type: "NOT-INTERESTED" }
  | { type: "HAVE"; pieceId: number }
  | { type: "BITFIELD"; field: Uint8Array }
  | { type: "REQUEST"; piece: number; offset: number; length: number }
  | { type: "PIECE"; piece: number; offset: number; block: Buffer }
  | { type: "CANCEL"; piece: number; offset: number; length: number }
  | { type: "PORT" };
