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
import { normalizeAddr } from "./normaliseAddr";
import { RateMeter } from "../utils/RateMeter";

const MAX_JUNK_BYTES = 5 * 1024 * 1024;

export class Peer {
  private readonly state: PeerState = createDefaultPeerState();
  private readonly remoteAddress;
  private readonly port;
  private junkBytes = 0;
  private readonly maxBufferLength: number;

  private buf: Buffer = Buffer.alloc(0);
  private availablePieces: Set<number> = new Set<number>();
  private disconnected = false;

  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly reqQueue: AsyncMessageQueue<Buffer> =
    new AsyncMessageQueue<Buffer>();
  private readonly incomingQueue: AsyncMessageQueue<Buffer> =
    new AsyncMessageQueue<Buffer>();

  public readonly down = new RateMeter();
  public clientName = "Unknown";
  private removeListener: (() => void)[] = [];

  constructor(
    private socket: Socket,
    private recon: Recon<TorrentEvents>,
    private pieceHandler: (piece: Piece, peer: Peer) => Promise<void>,
    private totalPieces: number,
  ) {
    this.maxBufferLength = Math.max(
      16 * 1024 + 9,
      Math.ceil(this.totalPieces / 8) + 1,
    );
    this.initReconHandlers();
    this.startReqLoop();
    this.startIncomingLoop();

    this.remoteAddress = normalizeAddr(this.socket.remoteAddress) ?? "unknown";
    this.port = this.socket.remotePort ?? 0;

    this.socket.on("data", this.onData);
    this.socket.on("close", this.disconnect);
    this.socket.on("error", this.disconnect);
  }

  private initReconHandlers() {
    this.removeListener.push(
      this.recon.once("DOWNLOAD_COMPLETE", () => {
        // console.log(
        //   "😙 Download finish ,disconnect peer:",
        //   this.remoteAddress,
        //   this.port,
        // );

        this.disconnect();
      }),
    );

    this.removeListener.push(
      this.recon.listen("PIECE:COMPLETED", (pieceIdx) =>
        this.HAVE_Req(pieceIdx),
      ),
    );
  }

  private disconnect = () => {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const off of this.removeListener) off();

    this.pendingRequests.clear();
    this.reqQueue.close();
    this.incomingQueue.close();
    this.socket.destroy();

    this.recon.announce("PEER:DISCONNECT", this);
  };

  private async processEvent(event: PeerEvent): Promise<void> {
    switch (event.type) {
      case "CHOKE":
        this.state.peerChoking = true;
        this.pendingRequests.clear();
        this.recon.announce("PEER:CHOKE", this);
        // console.log("😨 CHOKE US");

        return;

      case "UNCHOKE":
        this.state.peerChoking = false;
        this.recon.announce("PEER:UNCHOKE", this);
        // console.log("😎 UNCHOKE US");

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

        if (this.availablePieces.size === this.totalPieces) {
          this.recon.announce("SEEDER:CONNECT", this);
        }
        return;

      case "BITFIELD":
        addPiecesFromBitfield(event.field, this.availablePieces);

        // console.log("🏖️ received a bitfield", event.field);
        this.Interested_REQ();

        this.recon.announce("PEER:BITFIELD", this);

        if (this.availablePieces.size === this.totalPieces) {
          this.recon.announce("SEEDER:CONNECT", this);
        }
        return;

      case "REQUEST":
        // console.log("🥺 INCOMING REQUEST FOR A PIECE");
        if (this.state.amChoking) {
          return;
        }

        // this is for them to send us a request we will send them the piece which is a buffer
        // the peer manager will coordinate with piece manager to send them the request

        this.recon.announce(
          "PEER:INCOMING_PIECE_REQUEST",
          { ...event.block },
          this,
        );
        return;

      case "CANCEL":
        // Remove matching request from upload tracking

        // not implemented and not important
        return;

      case "PIECE": {
        const pieceKey = `${event.piece.pieceIdx},${event.piece.offset}`;
        const pendingReq = this.pendingRequests.get(pieceKey);

        if (!pendingReq) return;

        if (pendingReq.request.length !== event.piece.block.length) {
          throw new Error("Received piece with incorrect length");
        }

        this.pendingRequests.delete(pieceKey);
        this.down.add(event.piece.block.length);

        await this.pieceHandler(event.piece, this);
        return;
      }
      case "PORT":
        return;

      case "EXTENDED":
        console.log("Ignore extended req 😂");
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
    const { pieceIdx, offset, length } = req;
    const buf = Buffer.alloc(17);

    buf.writeUInt32BE(13, 0);
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

  private Interested_REQ(): void {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]);

    this.state.amInterested = true;
    this.reqQueue.push(buf);
  }

  private async startReqLoop() {
    while (true) {
      const req = await this.reqQueue.pop();
      if (req === undefined) break;

      this.socket.write(req);
    }
  }

  public startAfterHandshake(initialData: Buffer, bitfield: Buffer) {
    if (initialData.length > 0) this.onData(initialData);
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
      if (this.incomingQueue.length < 32) this.socket.resume();
      if (message === undefined || this.disconnected) break;

      try {
        await this.processEvent(decodeIncomingPeerMessage(message));
      } catch (e) {
        console.warn("bad message, dropping peer", e);
        this.disconnect();
        break;
      }
    }
  }

  public get isPeerChoking(): boolean {
    return this.state.peerChoking;
  }

  public get pieces(): ReadonlySet<number> {
    return this.availablePieces;
  }

  private onData = (chunk: Buffer) => {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);

    while (true) {
      // Need the 4-byte message length prefix
      if (this.buf.length < 4) break;

      const messageLen = this.buf.readUInt32BE(0);
      if (messageLen > this.maxBufferLength)
        return this.ban(
          `🔨 Banning peer ${this.clientName} for sending oversized message`,
        );

      // Need the complete message
      if (this.buf.length < 4 + messageLen) break;

      // Keep-alive
      if (messageLen === 0) {
        this.buf = this.buf.subarray(4);
        continue;
      }

      // const message = this.buf.subarray(4, 4 + messageLen);
      const message = this.buf.subarray(4, 4 + messageLen);

      // console.log(`📥 MESSAGE id=${message[0]} length=${messageLen}`);

      this.buf = this.buf.subarray(4 + messageLen);
      this.incomingQueue.push(message);
    }

    if (this.incomingQueue.length > 128) this.socket.pause();
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

  private HAVE_Req(pieceIdx: number) {
    const haveBuf = Buffer.alloc(9);

    haveBuf.writeUInt32BE(5, 0);
    haveBuf[4] = 0x4;
    haveBuf.writeUInt32BE(pieceIdx, 5);

    // console.log(`😈 SENT Have req ${pieceIdx}`);
    this.reqQueue.push(haveBuf);
  }

  public SEND_PIECE({ pieceIdx, offset }: BlockRequest, blockBuf: Buffer) {
    // 4 bytes for length 1 for messge id 4 + 4 for pieceIdx and offset rest for the piece itself
    const req = Buffer.alloc(13 + blockBuf.length);

    req.writeUInt32BE(9 + blockBuf.length, 0);
    // message id for piece request is 7;
    req[4] = 0x7;
    req.writeUint32BE(pieceIdx, 5);
    req.writeUint32BE(offset, 9);

    req.set(blockBuf, 13);
    this.reqQueue.push(req);
  }

  public staleRequests(maxAgeMs: number): BlockRequest[] {
    const now = Date.now();
    const stale: BlockRequest[] = [];
    for (const [key, { request, sentAt }] of this.pendingRequests) {
      if (now - sentAt > maxAgeMs) {
        stale.push(request);
        this.pendingRequests.delete(key);
      }
    }
    return stale;
  }

  public ban(reason: string) {
    if (this.disconnected) return;
    console.log(`🔨 banning ${this.clientName}: ${reason}`);

    this.recon.announce("PEER:BAN", this);
    this.disconnect();
  }
  public addJunk(bytes: number) {
    this.junkBytes += bytes;
    if (this.junkBytes > MAX_JUNK_BYTES)
      this.ban(`wasted ${this.junkBytes} bytes`);
  }
  /************************************************************************ */
  // API SECTION
  public get ip() {
    return this.remoteAddress;
  }

  public get inFlight(): number {
    return this.pendingRequests.size;
  }

  public get peerName() {
    return this.clientName;
  }

  public get addr() {
    return `${this.remoteAddress},${this.port}`;
  }

  /************************************************************************ */
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
