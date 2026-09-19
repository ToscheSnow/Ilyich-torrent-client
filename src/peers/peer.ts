import type {
  BlockRequest,
  PeerEvent,
  PeerState,
  PendingRequest,
  Piece,
} from "../types/peerTypes";
import { availablePieces } from "./bitfield";

export const defaultPeerState: PeerState = {
  amChoking: true,

  // i want something
  amInterested: false,

  // i can not receive
  peerChoking: true,

  // they want something
  peerInterested: false,
};

export class Peer {
  private state: PeerState;

  private pieces = new Set<number>();

  private pendingRequests = new Map<string, PendingRequest>();
  private requestQueue: BlockRequest[] = [];

  constructor(peerConfig: PeerState) {
    this.state = peerConfig;
  }

  public handleEvent(event: PeerEvent): void {
    switch (event.type) {
      case "CHOKE":
        this.state.peerChoking = true;
        break;

      case "UNCHOKE":
        this.state.peerChoking = false;
        break;

      case "INTERESTED":
        this.state.peerInterested = true;
        break;

      case "NOT-INTERESTED":
        this.state.peerInterested = false;
        break;

      case "HAVE":
        this.pieces.add(event.pieceId);
        break;

      case "BITFIELD":
        // Decode event.field and update this.pieces
        availablePieces(event.field, this.pieces);
        break;

      case "REQUEST":
        if (this.state.amChoking) {
          throw new Error("Peer requested while choked");
        }

        // Validate request
        break;

      case "CANCEL":
        // Remove matching request from upload tracking
        break;

      case "PIECE":
        if (this.state.peerChoking) {
          throw new Error("Received piece while peer is choking");
        }
        const pieceKey = this.getPieceKey(event.piece);
        const pendingReq = this.pendingRequests.get(pieceKey);

        if (!pendingReq) {
          throw new Error("Received unexpected piece");
        }

        if (pendingReq.request.length !== event.piece.block.length) {
          throw new Error("Received piece with incorrect length");
        }

        this.pendingRequests.delete(pieceKey);

        // hand block to piece manager later
        break;

      case "PORT":
        break;
    }
  }

  private getPieceKey({ pieceIdx, offset }: Piece): string {
    return `${pieceIdx},${offset}`;
  }
}
