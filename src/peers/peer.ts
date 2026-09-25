import { AsyncMessageQueue } from "../Queues/MessageQueue";
import type {
  BlockRequest,
  PeerEvent,
  PeerState,
  PendingRequest,
  Piece,
} from "../types/peerTypes";
import { addPiecesFromBitfield } from "./bitfield";
import { Socket } from "net";
import { decodeIncomingPeerMessage } from "./parseEventFromMessage";
import type { Recon } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";

export class Peer {
  private buf: Buffer = Buffer.alloc(0);
  private availablePieces: Set<number> = new Set<number>();
  private disconnected = false;

  private pendingRequests = new Map<string, PendingRequest>();
  private reqQueue: AsyncMessageQueue<Buffer> = new AsyncMessageQueue<Buffer>();
  private incomingQueue: AsyncMessageQueue<Buffer> =
    new AsyncMessageQueue<Buffer>();

  constructor(
    private socket: Socket,
    private recon: Recon<TorrentEvents>,
    private pieceHandler: (piece: Piece, peer: Peer) => Promise<void>,
    private state: PeerState = createDefaultPeerState(),
  ) {
    this.initReconHandlers();
    this.startReqLoop();
    this.startIncomingLoop();

    this.socket.on("data", this.onData);

    this.socket.on("close", this.disconnect);

    this.socket.on("error", this.disconnect);
  }

  private initReconHandlers() {
    this.recon.once("DOWNLOAD_COMPLETE", () => {
      this.socket.destroy();
      this.pendingRequests.clear();

      this.reqQueue.close();
      this.incomingQueue.close();
    });
  }

  private disconnect = () => {
    if (this.disconnected) return;

    this.disconnected = true;
    this.recon.announce("PEER:DISCONNECT", this);
  };

  public async processEvent(event: PeerEvent): Promise<void> {
    switch (event.type) {
      case "CHOKE":
        this.state.peerChoking = true;
        this.recon.announce("PEER:CHOKE", this);
        console.log("They choked us");

        return;

      case "UNCHOKE":
        this.state.peerChoking = false;
        this.recon.announce("PEER:UNCHOKE", this);
        console.log("They unchoked us");

        return;

      case "INTERESTED":
        console.log("(I) They are interested");

        this.state.peerInterested = true;
        this.state.amChoking = false;
        this.UNCHOKE_Req();

        return;

      case "NOT_INTERESTED":
        this.state.peerInterested = false;
        return;

      case "HAVE":
        this.availablePieces.add(event.pieceId);
        this.recon.announce("PEER:HAVE", this);
        return;

      case "BITFIELD":
        addPiecesFromBitfield(event.field, this.availablePieces);

        console.log("received a bitfield");
        this.Interested_REQ();

        this.recon.announce("PEER:BITFIELD", this);
        return;

      case "REQUEST":
        // console.log(
        //   `🍒 incoming request: piece=${event.block.pieceIdx} offset=${event.block.offset} length=${event.block.length}`,
        // );
        if (this.state.amChoking) {
          return;
        }

        // this is for them to send us a request we will send them the piece which is a buffer
        // the peer manager will coordinate with piece manager to send them the request
        console.log("Received a request for a block");
        
        this.recon.announce(
          "PEER:INCOMING_PIECE_REQUEST",
          { ...event.block },
          this,
        );
        return;

      case "CANCEL":
        // Remove matching request from upload tracking

        // not implemented and not important
        //
        return;

      case "PIECE": {
        const pieceKey = `${event.piece.pieceIdx},${event.piece.offset}`;
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

        this.pendingRequests.delete(pieceKey);

        // console.log("Received a block");

        await this.pieceHandler(event.piece, this);

        return;
      }
      case "PORT":
        return;

      case "EXTENDED":
        // console.log("Ignore extended req 😂");
        return;

      default:
        throw new Error("Invalid call to peer event handler");
    }
  }

  public request(req: BlockRequest): void {
    //if not valid request throw
    // console.log(
    //   `📤 REQUEST piece=${req.pieceIdx} offset=${req.offset} length=${req.length}`,
    // );
    // console.log("📥 QUEUING REQUEST", req.pieceIdx, req.offset);
    const { pieceIdx, offset, length } = req;
    const buf = Buffer.alloc(17);

    buf.writeUInt32BE(13, 0); // <-- FIX
    buf[4] = 0x06;

    buf.writeUInt32BE(pieceIdx, 5);
    buf.writeUInt32BE(offset, 9);
    buf.writeUInt32BE(length, 13);

    this.pendingRequests.set(`${pieceIdx},${offset}`, {
      request: req,
      sentAt: Date.now(),
    });

    this.reqQueue.push(buf);
  }

  public cancelReq(req: BlockRequest): void {
    const { pieceIdx, offset, length } = req;
    //if not valid request throw
    const buf = Buffer.alloc(17);

    // 13 bytes always in hex for cancel request
    buf.writeUInt32BE(13, 0); // length

    // message id 8 for canceling a request
    buf[4] = 0x08; //

    buf.writeUInt32BE(pieceIdx, 5);
    buf.writeUInt32BE(offset, 9);
    buf.writeUInt32BE(length, 13);

    this.pendingRequests.delete(`${req.pieceIdx},${req.offset}`);
    this.reqQueue.push(buf);
  }

  public Interested_REQ(): void {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]);

    this.state.amInterested = true;
    this.reqQueue.push(buf);
  }

  private async startReqLoop() {
    console.log("🚦 REQ LOOP STARTED");

    while (true) {
      // console.log("👀 WAITING");

      const req = await this.reqQueue.pop();

      if (req === undefined) break;

      this.socket.write(req);

      // console.log("OUTGOING", req[4]);
    }
  }

  public startAfterHandshake(initialData: Buffer, bitfield: Buffer) {
    this.receiveInitialData(initialData);

    const req = this.sendBitfieldReq(bitfield);

    this.reqQueue.push(req);
    this.Interested_REQ();
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
      if (message === undefined) break;

      const event = decodeIncomingPeerMessage(message!);

      await this.processEvent(event);
    }
  }

  public get isPeerChoking(): boolean {
    return this.state.peerChoking;
  }

  public get pieces(): ReadonlySet<number> {
    return this.availablePieces;
  }

  // public get isOverloaded(): boolean {
  //   return this.pendingRequests.size >= this.state.maxInFlight;
  // }

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

  private UNCHOKE_Req() {
    console.log(`📤 UNCHOKE PEER `);

    const unchokeBuf = Buffer.alloc(5);

    // length afterwards is 1
    unchokeBuf.writeUInt32BE(1, 0);

    // Unchoke message id is 1
    unchokeBuf[4] = 0x1;

    this.reqQueue.push(unchokeBuf);
  }

  public HAVE_Req(pieceIdx: number) {
    const haveBuf = Buffer.alloc(9);

    haveBuf.writeUInt32BE(5, 0);
    haveBuf[4] = 0x4;
    haveBuf.writeUInt32BE(pieceIdx, 5);

    // console.log(`😈 SENT Have req ${pieceIdx}`);
    this.reqQueue.push(haveBuf);
  }

  public SEND_PIECE({ pieceIdx, offset }: BlockRequest, blockBuf: Buffer) {
    // 4 bytes for length 1 for messge id 4 + 4 for pieceIdx and offset rest for the piece itself
    const req = Buffer.alloc(4 + 1 + 4 + 4 + blockBuf.length);

    req.writeUInt32BE(1 + 4 + 4 + blockBuf.length, 0);
    // message id for piece request is 7;
    req[4] = 0x7;

    req.writeUint32BE(pieceIdx, 5);
    req.writeUint32BE(offset, 9);

    req.set(blockBuf, 13);

    this.reqQueue.push(req);
  }

  public get inFlight(): number {
    return this.pendingRequests.size;
  }
}

// dont remove this is for the factory if you use a shared state all peers get the same reference
function createDefaultPeerState(): PeerState {
  return {
    amChoking: true,
    amInterested: false,
    peerChoking: true,
    peerInterested: false,
    maxInFlight: 10,
  };
}
