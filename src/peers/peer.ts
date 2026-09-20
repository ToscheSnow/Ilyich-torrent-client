import { AsyncMessageQueue } from "../Queues/MessageQueue";
import type {
  BlockRequest,
  PeerEvent,
  PeerState,
  PendingRequest,
  Piece,
  PieceInfo,
} from "../types/peerTypes";
import { availablePieces } from "./bitfield";
import { Socket } from "net";
import type { SchedulerDispatchCallback } from "../types/schedulerTypes";
import { parseEventFromMessage } from "./parseEventFromMessage";

export const defaultPeerState: PeerState = {
  amChoking: true,

  // i want something
  amInterested: false,

  // i can not receive
  peerChoking: true,

  // they want something
  peerInterested: false,

  maxInFlight: 10,
};

export class Peer {
  private state: PeerState;
  private buf: Buffer = Buffer.alloc(0);
  private availablePieces: Set<number> = new Set<number>();

  private pendingRequests = new Map<string, PendingRequest>();
  private reqQueue: AsyncMessageQueue<Buffer> = new AsyncMessageQueue<Buffer>();
  private incomingQueue: AsyncMessageQueue<Buffer> =
    new AsyncMessageQueue<Buffer>();

  constructor(
    peerConfig: PeerState,
    private socket: Socket,
    private schedulerDispatch: SchedulerDispatchCallback,
    private pieceHandler: (piece: Piece) => Promise<void>,
  ) {
    this.state = peerConfig;

    this.startReqLoop();
    this.startIncomingLoop();

    this.socket.on("data", this.onData);

    this.socket.on("close", () => {
      this.schedulerDispatch({ type: "DISCONNECT", peer: this });
    });

    this.socket.on("error", (e: Error) => {
      console.log(e);
      this.schedulerDispatch({ type: "DISCONNECT", peer: this });
    });
  }

  public async handleEvent(event: PeerEvent): Promise<void> {
    switch (event.type) {
      case "CHOKE":
        this.state.peerChoking = true;
        this.schedulerDispatch({ type: "CHOKE", peer: this });
        return;

      case "UNCHOKE":
        this.state.peerChoking = false;
        this.schedulerDispatch({ type: "UNCHOKE", peer: this });
        return;

      case "INTERESTED":
        this.state.peerInterested = true;
        return;

      case "NOT-INTERESTED":
        this.state.peerInterested = false;
        return;

      case "HAVE":
        this.availablePieces.add(event.pieceId);
        this.schedulerDispatch({ type: "HAVE", peer: this });
        return;

      case "BITFIELD":
        // Decode event.field and update this.availablePieces
        availablePieces(event.field, this.availablePieces);
        this.schedulerDispatch({ type: "BITFIELD", peer: this });
        console.log(`Peer has ${this.availablePieces.size} pieces available`);
        return;

      case "REQUEST":
        if (this.state.amChoking) {
          throw new Error("Peer requested while choked");
        }
        // this is for them to send us a request we will send them the piece which is a buffer
        return;

      case "CANCEL":
        // Remove matching request from upload tracking

        //
        return;

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

        // pieceHandler (PieceManager.receiveBlock) already dispatches
        // BLOCK_RECEIVED to the scheduler itself once it's validated the
        // block - dispatching it again here unconditionally was redundant
        // and could fire even for blocks PieceManager rejected.

        console.log(
          `Got block piece=${event.piece.pieceIdx} offset=${event.piece.offset} len=${event.piece.block.length}`,
        );

        await this.pieceHandler(event.piece);
        this.pendingRequests.delete(pieceKey);

        return;

      case "PORT":
        return;
      default:
        throw new Error("Invalid call to peer event handler");
    }
  }

  private getPieceKey({ pieceIdx, offset }: PieceInfo): string {
    return `${pieceIdx},${offset}`;
  }

  public setDispatch(dispatch: SchedulerDispatchCallback) {
    this.schedulerDispatch = dispatch;
  }

  private REQUEST_BUFFER({ pieceIdx, offset, length }: BlockRequest): Buffer {
    const buf = Buffer.alloc(17);

    buf.writeUInt32BE(13, 0); // <-- FIX
    buf[4] = 0x06;

    buf.writeUInt32BE(pieceIdx, 5);
    buf.writeUInt32BE(offset, 9);
    buf.writeUInt32BE(length, 13);

    return buf;
  }

  private CANCEL_BUFFER({ pieceIdx, offset, length }: BlockRequest): Buffer {
    const buf = Buffer.alloc(17);

    // 13 bytes always in hex for cancel request
    buf.writeUInt32BE(13, 0); // length

    // message id 8 for canceling a request
    buf[4] = 0x08; //

    buf.writeUInt32BE(pieceIdx, 5);

    buf.writeUInt32BE(offset, 9);

    buf.writeUInt32BE(length, 13);

    return buf;
  }

  public request(req: BlockRequest): void {
    //if not valid request throw
    const buf = this.REQUEST_BUFFER(req);

    this.pendingRequests.set(`${req.pieceIdx},${req.offset}`, {
      request: req,
      sentAt: Date.now(),
    });
    this.reqQueue.push(buf);
  }

  public cancelReq(req: BlockRequest): void {
    //if not valid request throw
    const buf = this.CANCEL_BUFFER(req);

    this.pendingRequests.delete(`${req.pieceIdx},${req.offset}`);
    this.reqQueue.push(buf);
  }

  public interested(): void {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]);

    this.state.amInterested = true;
    this.reqQueue.push(buf);
  }

  private async startReqLoop() {
    while (true) {
      const req = await this.reqQueue.pop();

      console.log(
        `📤 SEND ${this.socket.remoteAddress}:${this.socket.remotePort}:`,
        req.toString("hex"),
      );

      this.socket.write(req);
    }
  }

  public startAfterHandshake(initialData: Buffer) {
    this.receiveInitialData(initialData);
    this.interested();
  }

  private async startIncomingLoop() {
    while (true) {
      const message = await this.incomingQueue.pop();
      const event = parseEventFromMessage(message);

      await this.handleEvent(event);
    }
  }

  public get isPeerChoking(): boolean {
    return this.state.peerChoking;
  }

  public get pieces(): ReadonlySet<number> {
    return this.availablePieces;
  }

  public get isOverloaded(): boolean {
    return this.pendingRequests.size >= this.state.maxInFlight;
  }

  public receiveInitialData(data: Buffer) {
    if (data.length === 0) return;

    this.onData(data);
  }

  public onData = async (chunk: Buffer) => {
    this.buf = Buffer.concat([this.buf, chunk]);

    while (true) {
      // Need the 4-byte message length prefix
      if (this.buf.length < 4) break;

      const messageLen = this.buf.readUInt32BE(0);

      // Need the complete message
      if (this.buf.length < 4 + messageLen) break;

      // Keep-alive
      if (messageLen === 0) {
        this.buf = this.buf.subarray(4);
        continue;
      }

      const message = this.buf.subarray(4, 4 + messageLen);
      this.buf = this.buf.subarray(4 + messageLen);
      this.incomingQueue.push(message);
    }
  };
}
