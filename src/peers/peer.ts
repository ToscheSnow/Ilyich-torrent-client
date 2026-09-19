import { AsyncMessageQueue } from "../Queues/MessageQueue";
import type {
  BlockRequest,
  PeerEvent,
  PeerState,
  PendingRequest,
  Piece,
} from "../types/peerTypes";
import { availablePieces } from "./bitfield";
import { Socket } from "net";

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
  private reqQueue: AsyncMessageQueue<Buffer> = new AsyncMessageQueue<Buffer>();

  constructor(
    peerConfig: PeerState,
    private socket: Socket,
  ) {
    this.state = peerConfig;

    this.startLoop();
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
        // this is for them to send us a request we will send them the piece which is a buffer
        break;

      case "CANCEL":
        // Remove matching request from upload tracking

        //
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

  private REQUEST_BUFFER({ piece, offset, length }: BlockRequest): Buffer {
    const buf = Buffer.alloc(17);

    // 13 bytes for piece request
    buf[0] = 0x0d; // length

    // piece request id is 6
    buf[4] = 0x06; //

    buf.writeUInt32BE(piece, 5);

    buf.writeUInt32BE(offset, 9);

    buf.writeUInt32BE(length, 13);

    return buf;
  }

  private CANCEL_BUFFER({ piece, offset, length }: BlockRequest): Buffer {
    const buf = Buffer.alloc(17);

    // 13 bytes always in hex for cancel request
    buf[0] = 0x0d; // length

    // message id 8 for canceling a request
    buf[4] = 0x08; //

    buf.writeUInt32BE(piece, 5);

    buf.writeUInt32BE(offset, 9);

    buf.writeUInt32BE(length, 13);

    return buf;
  }

  public request(req: Buffer): void {
    //if not valid request throw

    //check if we are being choked 😂

    this.reqQueue.push(req);
  }

  public cancelReq(req: Buffer): void {
    //if not valid request throw

    this.reqQueue.push(req);
  }

  private async startLoop() {
    while (true) {
      const req = await this.reqQueue.pop();
      this.socket.write(req);
    }
  }
}
