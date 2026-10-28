import type { Recon } from "../Emitter/Recon";
import type { Peer } from "../peers/peer";
import type { PieceManager } from "../Pieces/PieceManager";
import { AsyncMessageQueue } from "../Queues/MessageQueue";
import type { TorrentEvents } from "../torrent";
import type { BlockRequest } from "../types/peerTypes";
import type { SchedulerEvent } from "../types/schedulerTypes";
import { BLOCK_SIZE } from "../client";

const MIN_DEPTH = 20; // blocks in flight for a new or slow peer
const MAX_DEPTH = 150;
const TARGET_QUEUE_SECS = 4; // keep ~4s of data queued per peer
const STALE_REQ_MS = 10_000; // an individual request older than this is re-queued
const STALL_MS = 5_000; // a started piece with no new block for this long is "stalled"
const PARK_MS = 15_000; // how long a parked piece sits out
const MAX_PARKED = 24; // parked pieces keep partial blocks in RAM, so bound them
const SWEEP_MS = 2_000;

export class Scheduler {
  private readonly MAX_ACTIVE_PIECES: number;
  private eventQueue = new AsyncMessageQueue<SchedulerEvent>();

  // ---- piece bookkeeping ----
  private pendingPieceToBlocks = new Map<number, number[]>(); // started piece -> offsets still to hand out
  private piecesInSlot = new Set<number>(); // pieces holding an active slot
  private lastProgress = new Map<number, number>(); // started piece -> last block time
  private stalls = new Map<number, number>(); // consecutive stalls with no progress
  private cooldown = new Map<number, number>(); // piece -> don't start before this time
  private failCount = new Map<number, number>();
  private parked = new Set<number>(); // insertion ordered, oldest first

  // ---- request bookkeeping ----
  private reqToPeer = new Map<number, Peer>(); //answers which peer was to furnish this block
  private peerToReqSet = new Map<Peer, Set<number>>(); // tells which requests this peer was to furnish
  private peerBlockRate = new Map<Peer, { blocks: number; perSec: number }>();
  private lastSweep = Date.now();

  private verifiedPieces: ReadonlySet<number>;
  private offHandlers: (() => void)[] = [];
  private offDone?: () => void;
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private pieceManager: PieceManager,
    private peers: Set<Peer>,
    private recon: Recon<TorrentEvents>,
    private blocksPerPiece: number, // ceil(pieceLength / BLOCK_SIZE)
  ) {
    this.MAX_ACTIVE_PIECES = Math.ceil(
      (125 * 1024 * 1024) / (this.blocksPerPiece * BLOCK_SIZE),
    );
    this.verifiedPieces = pieceManager.getVerifiedPieces().verifiedPieces;
    this.initReconHandlers();
    this.startEventLoop();
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_MS);
  }

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

      // hash failed: free the slot and back off before retrying 🔁
      this.recon.listen("PIECE:FAILED", (idx) => {
        this.forgetPiece(idx);
        const n = (this.failCount.get(idx) ?? 0) + 1;
        this.failCount.set(idx, n);
        this.cooldown.set(idx, Date.now() + Math.min(1000 * 2 ** n, 60_000));
        this.schedule();
      }),

      this.recon.listen("PIECE:COMPLETED", (idx) => {
        this.forgetPiece(idx);
        this.failCount.delete(idx);
        this.cooldown.delete(idx);
        this.schedule();
      }),
    );

    this.offDone = this.recon.once("DOWNLOAD_COMPLETE", this.dispose);
  }

  public dispose = () => {
    clearInterval(this.sweepTimer);
    this.eventQueue.close();
    this.reqToPeer.clear();
    this.peerToReqSet.clear();
    this.peerBlockRate.clear();
    this.pendingPieceToBlocks.clear();
    this.piecesInSlot.clear();
    this.parked.clear();
    this.lastProgress.clear();
    this.stalls.clear();
    this.cooldown.clear();
    this.failCount.clear();
    for (const off of this.offHandlers) off();
    this.offDone?.();
  };

  private async startEventLoop() {
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
        this.requestPeer(event.peer);
        return;

      case "UNCHOKE":
      case "HAVE":
        this.requestPeer(event.peer);
        return;

      case "BITFIELD":
        this.schedule();
        return;

      case "BLOCK_RECEIVED": {
        const { pieceIdx, offset } = event.piece;

        if (this.piecesInSlot.has(pieceIdx)) {
          this.lastProgress.set(pieceIdx, Date.now());
          this.stalls.delete(pieceIdx);
        }

        const key = this.key(pieceIdx, offset);
        const peer = this.reqToPeer.get(key);
        this.reqToPeer.delete(key);

        if (peer) {
          this.peerToReqSet.get(peer)?.delete(key);

          let r = this.peerBlockRate.get(peer);
          if (!r) this.peerBlockRate.set(peer, (r = { blocks: 0, perSec: 0 }));
          r.blocks++;

          this.requestPeer(peer);
        }
        return;
      }

      case "CHOKE":
        this.releaseBlocks(event.peer);
        this.schedule();
        return;

      case "DISCONNECT":
        this.peers.delete(event.peer);
        this.peerBlockRate.delete(event.peer);
        this.releaseBlocks(event.peer);
        this.schedule();
        return;

      default:
        throw new Error("Invalid dispatch to Scheduler");
    }
  }

  // ---------- scheduling ----------
  schedule() {
    for (const peer of this.peers) this.requestPeer(peer);
  }

  /** ~3 seconds of data per peer: slow peers can't hoard blocks anymore */
  private inFlightLimit(peer: Peer) {
    const perSec = this.peerBlockRate.get(peer)?.perSec ?? 0; // blocks per second
    return Math.min(
      MAX_DEPTH,
      Math.max(MIN_DEPTH, Math.ceil(perSec * TARGET_QUEUE_SECS)),
    );
  }

  private requestPeer(peer: Peer) {
    // disconnected peer or choking
    if (!this.peers.has(peer) || peer.isPeerChoking) return;

    const inflightLimit = this.inFlightLimit(peer);
    while (peer.inFlight < inflightLimit) {
      const req = this.nextFor(peer);
      if (!req) return;

      // setup reverse mappings
      const key = this.key(req.pieceIdx, req.offset);
      this.reqToPeer.set(key, peer);

      let set = this.peerToReqSet.get(peer);
      if (!set) this.peerToReqSet.set(peer, (set = new Set()));
      set.add(key);

      // internal peer machinery to request said BlockRequest
      peer.request(req);
    }
  }

  private nextFor(peer: Peer): BlockRequest | null {
    // 1) blocks from pieces that already hold a slot
    for (const [idx, offs] of this.pendingPieceToBlocks) {
      if (offs.length === 0) {
        this.pendingPieceToBlocks.delete(idx);
        continue;
      }
      if (!peer.pieces.has(idx)) continue;

      for (let i = offs.length - 1; i >= 0; i--) {
        const offset = offs[i]!;
        // don't ask the same peer twice for a block it's already fetching
        if (this.reqToPeer.get(this.key(idx, offset)) === peer) continue;

        offs.splice(i, 1);
        if (offs.length === 0) this.pendingPieceToBlocks.delete(idx);

        return {
          pieceIdx: idx,
          offset,
          length: this.pieceManager.validator.getBlockLength(idx, offset),
        };
      }
    }

    if (this.piecesInSlot.size >= this.MAX_ACTIVE_PIECES) return null;

    // 2) start a brand new piece this peer has (skipping the ones cooling down)
    const now = Date.now();
    for (const idx of peer.pieces) {
      if (this.piecesInSlot.has(idx) || this.verifiedPieces.has(idx)) continue;
      if ((this.cooldown.get(idx) ?? 0) > now) continue;

      const offsets = this.pieceManager.allOffsets(idx);
      if (offsets.length === 0) continue;

      this.startPiece(idx, offsets);
      return this.nextFor(peer);
    }
    return null;
  }

  private startPiece(idx: number, offs: number[]) {
    this.piecesInSlot.add(idx);
    this.parked.delete(idx);
    this.stalls.delete(idx);
    this.lastProgress.set(idx, Date.now());
    this.pendingPieceToBlocks.set(idx, offs);
  }

  /** piece finished or failed: forget every trace of it */
  private forgetPiece(idx: number) {
    const firstBlock = idx * this.blocksPerPiece;
    for (let block = 0; block < this.blocksPerPiece; block++) {
      const key = firstBlock + block;
      const p = this.reqToPeer.get(key);
      if (p) {
        this.peerToReqSet.get(p)?.delete(key);
        this.reqToPeer.delete(key);
      }
    }
    this.pendingPieceToBlocks.delete(idx);
    this.piecesInSlot.delete(idx);
    this.parked.delete(idx);
    this.lastProgress.delete(idx);
    this.stalls.delete(idx);
  }

  /** give the slot back, sit out for a while, keep the partial blocks (bounded) */
  private park(idx: number) {
    this.pendingPieceToBlocks.delete(idx);
    this.piecesInSlot.delete(idx);
    this.lastProgress.delete(idx);
    this.stalls.delete(idx);
    this.cooldown.set(idx, Date.now() + PARK_MS);
    this.parked.add(idx);

    while (this.parked.size > MAX_PARKED) {
      const oldest = this.parked.values().next().value!;
      this.parked.delete(oldest);
      this.pieceManager.dropPiece(oldest);
    }
  }

  /** put a block back in the pool, but only if it's still wanted */
  private requeue(pieceIdx: number, offset: number) {
    if (!this.piecesInSlot.has(pieceIdx)) return; // parked or done: don't resurrect it
    if (this.verifiedPieces.has(pieceIdx)) return;
    if (this.pieceManager.hasBlock(pieceIdx, offset)) return;

    let offs = this.pendingPieceToBlocks.get(pieceIdx);
    if (!offs) this.pendingPieceToBlocks.set(pieceIdx, (offs = []));
    if (!offs.includes(offset)) offs.push(offset);
  }

  // manage blocks requested by said peer when it is dropped
  private releaseBlocks(peer: Peer) {
    //blocks this peer was supposed to provide
    const blockIDs = this.peerToReqSet.get(peer);
    if (!blockIDs) return;

    for (const blockId of blockIDs) {
      // whether this block was to be provided by said peer
      if (this.reqToPeer.get(blockId) === peer) this.reqToPeer.delete(blockId);
      // not this peer but someone else
      else if (this.reqToPeer.has(blockId)) continue; // someone else is already fetching it

      // no one has queued this block
      this.requeue(
        Math.floor(blockId / this.blocksPerPiece),
        (blockId % this.blocksPerPiece) * BLOCK_SIZE,
      );
    }
    // clear the entire set since peer is dropped
    this.peerToReqSet.delete(peer);
  }

  private dispatch(event: SchedulerEvent) {
    this.eventQueue.push(event);
  }

  // ---------- maintenance ----------
  private updateRates(now: number) {
    const secs = Math.max((now - this.lastSweep) / 1000, 0.001);
    this.lastSweep = now;

    for (const r of this.peerBlockRate.values()) {
      const inst = r.blocks / secs;
      r.perSec = r.perSec === 0 ? inst : r.perSec * 0.5 + inst * 0.5;
      r.blocks = 0;
    }
  }

  private sweep() {
    const now = Date.now();
    this.updateRates(now);

    // 1) individual requests that have been outstanding too long
    for (const peer of this.peers) {
      for (const stale of peer.staleRequests(STALE_REQ_MS)) {
        const key = this.key(stale.pieceIdx, stale.offset);
        if (this.reqToPeer.get(key) === peer) this.reqToPeer.delete(key);

        this.peerToReqSet.get(peer)?.delete(key);

        if (!this.reqToPeer.has(key))
          this.requeue(stale.pieceIdx, stale.offset);
      }
    }

    // 2) pieces that stopped making progress
    for (const idx of [...this.piecesInSlot]) {
      if (now - (this.lastProgress.get(idx) ?? now) < STALL_MS) continue;

      const n = (this.stalls.get(idx) ?? 0) + 1;
      this.stalls.set(idx, n);

      if (n >= 2) {
        this.park(idx); // stalled twice: nobody can serve it right now
        continue;
      }

      // first stall: open the missing blocks to other peers (duplicates are fine)
      const missing = this.pieceManager.allOffsets(idx);
      if (missing.length > 0) this.pendingPieceToBlocks.set(idx, missing);
      this.lastProgress.set(idx, now);
    }

    this.schedule();
  }
}
