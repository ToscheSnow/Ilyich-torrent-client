import type { Recon } from "../Emitter/Recon";
import type { Peer } from "../peers/peer";
import type { PieceManager } from "../Pieces/PieceManager";
import { AsyncMessageQueue } from "../Queues/MessageQueue";
import type { TorrentEvents } from "../torrent";
import type { BlockRequest } from "../types/peerTypes";
import type { SchedulerEvent } from "../types/schedulerTypes";
import { BLOCK_SIZE } from "../client";

export class Scheduler {
  private readonly MAX_IN_FLIGHT: number = 150;
  private MAX_ACTIVE_PIECES: number;
  private eventQueue = new AsyncMessageQueue<SchedulerEvent>();

  private active = new Map<number, number[]>();
  private started = new Set<number>();
  private inflight = new Map<number, Peer>();
  private byPeer = new Map<Peer, Set<number>>();
  private verifiedPieces: ReadonlySet<number>;
  private offHandlers: (() => void)[] = [];
  private offDone?: () => void;

  constructor(
    private pieceManager: PieceManager,
    private peers: Set<Peer>,
    private recon: Recon<TorrentEvents>,
    private blocksPerPiece: number, // ceil(pieceLength / BLOCK_SIZE)
  ) {
    this.verifiedPieces = pieceManager.getVerifiedPieces().verifiedPieces;
    this.initReconHandlers();
    this.eventLoop();

    this.sweepTimer = setInterval(() => this.sweep(), 5000);

    this.MAX_ACTIVE_PIECES = Math.ceil(
      (125 * 1024 * 1024) / (this.blocksPerPiece * BLOCK_SIZE),
    );
  }

  // ---------- keys ----------
  private key(pieceIdx: number, offset: number) {
    return pieceIdx * this.blocksPerPiece + offset / BLOCK_SIZE;
  }

  // ---------- wiring ----------
  private initReconHandlers() {
    this.offHandlers.push(
      this.recon.listen("PEER:CONNECT", (peer) =>
        this.dispatch({ type: "CONNECTED", peer }),
      ),
      this.recon.listen("PEER:DISCONNECT", (peer) =>
        this.dispatch({ type: "DISCONNECT", peer }),
      ),
      this.recon.listen("PEER:CHOKE", (peer) =>
        this.dispatch({ type: "CHOKE", peer }),
      ),
      this.recon.listen("PEER:UNCHOKE", (peer) =>
        this.dispatch({ type: "UNCHOKE", peer }),
      ),
      this.recon.listen("PEER:HAVE", (peer) =>
        this.dispatch({ type: "HAVE", peer }),
      ),
      this.recon.listen("PEER:BITFIELD", () =>
        this.dispatch({ type: "BITFIELD" }),
      ),
      this.recon.listen("BLOCK:RECEIVED", (piece) =>
        this.dispatch({ type: "BLOCK_RECEIVED", piece }),
      ),
      // hash failed -> allow the piece to be re-activated 🔁
      this.recon.listen("PIECE:FAILED", (idx) => {
        this.started.delete(idx);
        this.active.delete(idx);
        this.schedule();
      }),
      this.recon.listen("PIECE:COMPLETED", (idx) => {
        this.started.delete(idx);
        this.schedule();
      }),
    );

    this.offDone = this.recon.once("DOWNLOAD_COMPLETE", this.dispose);
  }

  public dispose = () => {
    clearInterval(this.sweepTimer);
    this.eventQueue.close();
    this.inflight.clear();
    this.byPeer.clear();
    this.active.clear();
    this.started.clear();
    for (const off of this.offHandlers) off();
    this.offDone?.();
  };

  private async eventLoop() {
    while (true) {
      const event = await this.eventQueue.pop();
      if (event === undefined) break;
      this.processEvent(event);
    }
  }

  private processEvent(event: SchedulerEvent) {
    switch (event.type) {
      case "CONNECTED":
        this.peers.add(event.peer);
        this.fillPeer(event.peer);
        return;

      case "UNCHOKE":
      case "HAVE":
        this.fillPeer(event.peer); // only this peer changed 🎯
        return;

      case "BITFIELD":
        this.schedule();
        return;

      case "BLOCK_RECEIVED": {
        const { pieceIdx, offset } = event.piece;
        const key = this.key(pieceIdx, offset);
        const peer = this.inflight.get(key);
        this.inflight.delete(key);
        if (peer) {
          this.byPeer.get(peer)?.delete(key);
          this.fillPeer(peer); // refill the peer that just freed a slot
        }
        return;
      }

      case "CHOKE":
        this.release(event.peer); // O(that peer's blocks) ⚡
        this.schedule(); // other peers can pick up the slack
        return;

      case "DISCONNECT":
        this.peers.delete(event.peer);
        this.release(event.peer);
        this.schedule();
        return;

      default:
        throw new Error("Invalid dispatch to Scheduler");
    }
  }

  // ---------- scheduling ----------
  schedule() {
    for (const peer of this.peers) this.fillPeer(peer);
  }

  private fillPeer(peer: Peer) {
    if (!this.peers.has(peer) || peer.isPeerChoking) return;
    while (peer.inFlight < this.MAX_IN_FLIGHT) {
      const req = this.nextFor(peer);
      if (!req) return;

      const key = this.key(req.pieceIdx, req.offset);
      this.inflight.set(key, peer);

      let set = this.byPeer.get(peer);
      if (!set) this.byPeer.set(peer, (set = new Set()));
      set.add(key);

      peer.request(req);
    }
  }

  private nextFor(peer: Peer): BlockRequest | null {
    for (const [idx, offs] of this.active) {
      if (!peer.pieces.has(idx)) continue;
      const offset = offs.pop()!;
      if (offs.length === 0) this.active.delete(idx);
      return {
        pieceIdx: idx,
        offset,
        length: this.pieceManager.validator.getBlockLength(idx, offset),
      };
    }

    if (this.started.size >= this.MAX_ACTIVE_PIECES) return null;

    // 2) start a brand new piece this peer has
    for (const idx of peer.pieces) {
      if (this.started.has(idx) || this.verifiedPieces.has(idx)) continue;
      const offs = this.pieceManager.allOffsets(idx);
      if (offs.length === 0) continue;

      this.started.add(idx);
      this.active.set(idx, offs);
      return this.nextFor(peer);
    }
    return null;
  }

  private release(peer: Peer) {
    const keys = this.byPeer.get(peer);
    if (!keys) return;

    for (const key of keys) {
      this.inflight.delete(key);
      const pieceIdx = Math.floor(key / this.blocksPerPiece);
      if (this.verifiedPieces.has(pieceIdx)) continue;

      const offset = (key % this.blocksPerPiece) * BLOCK_SIZE;
      let offs = this.active.get(pieceIdx);
      if (!offs) this.active.set(pieceIdx, (offs = []));
      offs.push(offset);
    }
    this.byPeer.delete(peer);
  }

  public dispatch(event: SchedulerEvent) {
    this.eventQueue.push(event);
  }

  public get activeCount() {
    return this.active.size;
  }

  private sweepTimer: ReturnType<typeof setInterval>;

  private sweep() {
    for (const peer of this.peers) {
      for (const req of peer.takeStale(10_000)) {
        const key = this.key(req.pieceIdx, req.offset);
        if (this.inflight.get(key) === peer) this.inflight.delete(key);
        this.byPeer.get(peer)?.delete(key);

        if (this.verifiedPieces.has(req.pieceIdx)) continue;
        if (this.pieceManager.hasBlock(req.pieceIdx, req.offset)) continue;

        let offs = this.active.get(req.pieceIdx);
        if (!offs) this.active.set(req.pieceIdx, (offs = []));
        if (!offs.includes(req.offset)) offs.push(req.offset);
      }
    }
    this.schedule();
  }
}
