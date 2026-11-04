export interface PeerState {
  // i can not send
  amChoking: boolean;
  // i want something
  // i can not receive
  peerChoking: boolean;
  // they want something
  peerInterested: boolean;
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
  | { type: "NOT_INTERESTED" }
  | { type: "HAVE"; pieceId: number }
  | { type: "BITFIELD"; field: Uint8Array }
  | { type: "REQUEST"; block: BlockRequest }
  | { type: "PIECE"; piece: Piece }
  | { type: "CANCEL"; block: BlockRequest }
  | { type: "PORT"; port: number }
  | { type: "EXTENDED"; extendedMessageId: number };

export interface PieceInfo {
  pieceIdx: number;
  offset: number;
}
