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
  // 😰 i am choking them
  amChoking: true,

  // i want something
  amInterested: false,

  // i can not receive 😢
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
    private pieceHandler: (piece: Piece, peer: Peer) => Promise<void>,
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
        console.log("They choked us");

        return;

      case "UNCHOKE":
        this.state.peerChoking = false;
        console.log("They unchoked us");

        this.schedulerDispatch({ type: "UNCHOKE", peer: this });
        return;

      case "INTERESTED":
        console.log("(I) They are interested");

        this.state.peerInterested = true;
        this.state.amChoking = false;
        this.UNCHOKE_REQ();

        return;

      case "NOT-INTERESTED":
        this.state.peerInterested = false;
        return;

      case "HAVE":
        this.availablePieces.add(event.pieceId);
        this.schedulerDispatch({ type: "HAVE", peer: this });
        return;

      case "BITFIELD":
        availablePieces(event.field, this.availablePieces);

        console.log("(I) 📤 INTERESTED");
        this.INTERESTED_REQ();

        this.schedulerDispatch({ type: "BITFIELD", peer: this });
        return;
      case "REQUEST":
        console.log(
          `🍒 incoming request: piece=${event.block.pieceIdx} offset=${event.block.offset} length=${event.block.length}`,
        );

        if (this.state.amChoking) {
          return;
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
          console.warn(
            `⚠️ Received unexpected PIECE: piece=${event.piece.pieceIdx} offset=${event.piece.offset}`,
          );
          return;
        }

        if (pendingReq.request.length !== event.piece.block.length) {
          throw new Error("Received piece with incorrect length");
        }

        // cl

        await this.pieceHandler(event.piece, this);
        this.pendingRequests.delete(pieceKey);

        return;

      case "PORT":
        return;
      case "EXTENDED":
        console.log("Ignore extended req 😂");
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
    // console.log(
    //   `📤 REQUEST piece=${req.pieceIdx} offset=${req.offset} length=${req.length}`,
    // );
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

  public INTERESTED_REQ(): void {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]);

    this.state.amInterested = true;
    this.reqQueue.push(buf);
  }

  private async startReqLoop() {
    while (true) {
      const req = await this.reqQueue.pop();

      const ok = this.socket.write(req);

      if (req[4] === 0x05) {
        console.log("😇 SENT BITFIELD");
      }
    }
  }

  public startAfterHandshake(initialData: Buffer, bitfield: Buffer) {
    this.receiveInitialData(initialData);
    const req = this.sendBitfieldReq(bitfield);
    this.reqQueue.push(req);
    this.INTERESTED_REQ();
  }

  private sendBitfieldReq(bitfield: Buffer) {
    const buf = Buffer.alloc(bitfield.length + 1 + 4);

    buf.writeUInt32BE(bitfield.length + 1, 0);

    buf[4] = 0x5;

    buf.set(bitfield, 5);

    return buf;
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

  public onData = (chunk: Buffer) => {
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

      // console.log(`📥 MESSAGE id=${message[0]} length=${messageLen}`);

      this.buf = this.buf.subarray(4 + messageLen);
      this.incomingQueue.push(message);
    }
  };

  private UNCHOKE_BUF(): Buffer {
    // UNCHOKE_REQ is of length 5 = 4+1 bytes with no paylod
    const buf = Buffer.alloc(5);

    // length afterwards is 1
    buf.writeUInt32BE(1, 0);

    // Unchoke message id is 1
    buf[4] = 0x1;

    return buf;
  }

  private UNCHOKE_REQ() {
    console.log(`📤 UNCHOKE PEER `);
    const unchokeBuf = this.UNCHOKE_BUF();

    this.reqQueue.push(unchokeBuf);
  }

  private HAVE_BUF(pieceIdx: number): Buffer {
    const buf = Buffer.alloc(9);

    buf.writeUInt32BE(5, 0);
    buf[4] = 0x4;
    buf.writeUInt32BE(pieceIdx, 5);

    return buf;
  }

  public HAVE_REQ(pieceIdx: number) {
    const haveBuf = this.HAVE_BUF(pieceIdx);

    // console.log(`😈 SENT Have req ${pieceIdx}`);
    this.reqQueue.push(haveBuf);
  }
}
