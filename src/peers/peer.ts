import type { BlockRequest, PeerEvent, PeerState } from "../types/peerTypes";

export class Peer {
  private state: PeerState;

  private pieces = new Set<number>();

  private pendingRequests = new Map<string, BlockRequest>();
  private requestQueue: BlockRequest[] = [];

  constructor(peerConfig: PeerState) {
    this.state = peerConfig;
  }

  private transition(event: PeerEvent): void {
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

        // Match against pendingRequests
        // Remove it
        // Hand block to piece manager
        break;

      case "PORT":
        break;
    }
  }
}
