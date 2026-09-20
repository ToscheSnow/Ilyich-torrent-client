export interface PeerState {
  // i can send
  amChoking: boolean;

  // i want something
  amInterested: boolean;

  // i can not receive
  peerChoking: boolean;

  // they want something
  peerInterested: boolean;

  maxInFlight: number;
}

export interface BlockRequest {
  pieceIdx: number;
  offset: number;
  length: number;
}

export interface Piece extends PieceInfo {
  block: Buffer;
}

export interface PendingRequest {
  request: BlockRequest;
  sentAt: number;
}

export type PeerEvent =
  | { type: "CHOKE" }
  | { type: "UNCHOKE" }
  | { type: "INTERESTED" }
  | { type: "NOT-INTERESTED" }
  | { type: "HAVE"; pieceId: number }
  | { type: "BITFIELD"; field: Uint8Array }
  | { type: "REQUEST"; block: BlockRequest }
  | { type: "PIECE"; piece: Piece }
  | { type: "CANCEL"; block: BlockRequest }
  | { type: "PORT" }
  | { type: "EXTENDED" };

export interface PieceInfo {
  pieceIdx: number;
  offset: number;
}
