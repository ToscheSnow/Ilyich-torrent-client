import type { Recon } from "../Emitter/Recon";
import type { Peer } from "../peers/peer";
import type { PieceManager } from "../Pieces/PieceManager";
import { AsyncMessageQueue } from "../Queues/MessageQueue";
import type { TorrentEvents } from "../torrent";
import type { SchedulerEvent } from "../types/schedulerTypes";

//schedule blocks
//
// if peer is not choking us
// if the peer has the piece
// peer queue must is not overloaded (max fly req)
// &&
// if the piece is complete ask pieceManager
// blocks which exist in this piece
//. && not already scheduled

export class Scheduler {
  // outstanding request blocks and corresponding peers
  //
  // every block is requested by a unique peer
  private requestedBlocks: Map<string, Peer> = new Map<string, Peer>();
  private readonly MAX_IN_FLIGHT = 20;
  // process Scheduler events async to avoid callback spaghetti
  private eventQueue: AsyncMessageQueue<SchedulerEvent> =
    new AsyncMessageQueue<SchedulerEvent>();

  // inject dependencies instead ,since Scheduler shouldnt create Objects
  constructor(
    private pieceManager: PieceManager,
    private peers: Set<Peer>,
    private recon: Recon<TorrentEvents>,
  ) {
    // recon.listen(event, fn)
    this.initReconHandlers();
    this.eventLoop();
  }

  private initReconHandlers() {
    const handlers: (() => void)[] = [];
    handlers.push(
      this.recon.listen("PEER:CONNECT", (peer) =>
        this.dispatch({ type: "CONNECTED", peer }),
      ),
    );

    handlers.push(
      this.recon.listen("PEER:DISCONNECT", (peer) =>
        this.dispatch({ type: "DISCONNECT", peer }),
      ),
    );

    handlers.push(
      this.recon.listen("BLOCK:RECEIVED", (piece) =>
        this.dispatch({
          type: "BLOCK_RECEIVED",
          piece,
        }),
      ),
    );

    handlers.push(
      this.recon.listen("PEER:UNCHOKE", (peer) =>
        this.dispatch({ type: "UNCHOKE", peer }),
      ),
    );

    handlers.push(
      this.recon.listen("PEER:HAVE", (peer) =>
        this.dispatch({ type: "HAVE", peer }),
      ),
    );

    handlers.push(
      this.recon.listen("PEER:BITFIELD", () =>
        this.dispatch({ type: "BITFIELD" }),
      ),
    );

    handlers.push(this.recon.listen("PIECE:COMPLETED", () => this.schedule()));

    handlers.push(
      this.recon.once("DOWNLOAD_COMPLETE", () => {
        this.requestedBlocks.clear();
        this.eventQueue.close();
        for (const off of handlers) off();
      }),
    );
  }

  // processEventLoop for checking events
  private async eventLoop() {
    while (true) {
      const event = await this.eventQueue.pop();
      if (event === undefined) break;
      this.processEvent(event);
    }
  }

  // reduce Scheduler events to corresponding actions
  private processEvent(event: SchedulerEvent) {
    switch (event.type) {
      case "CONNECTED": {
        //
        this.peers.add(event.peer);
        this.schedule();
        return;
      }
      case "UNCHOKE": {
        this.schedule();
        return;
      }
      case "BITFIELD": {
        this.schedule();
        return;
      }
      case "HAVE": {
        this.schedule();
        return;
      }
      case "BLOCK_RECEIVED": {
        const key = `${event.piece.pieceIdx},${event.piece.offset}`;
        // remove from outstanding requests
        this.requestedBlocks.delete(key);
        this.schedule();
        return;
      }
      case "CHOKE": {
        const chokingPeer = event.peer;

        const toRelease = [];
        for (const [block, peer] of this.requestedBlocks.entries()) {
          if (peer === chokingPeer) toRelease.push(block);
        }

        for (const block of toRelease) this.requestedBlocks.delete(block);
        this.schedule();
        return;
      }
      case "DISCONNECT": {
        const disconnectedPeer = event.peer;
        this.peers.delete(disconnectedPeer);

        const toDelete = [];
        for (const [block, peer] of this.requestedBlocks.entries()) {
          if (peer === disconnectedPeer) toDelete.push(block);
        }

        for (const block of toDelete) this.requestedBlocks.delete(block);
        this.schedule();
        return;
      }
      default:
        throw new Error("Invalid dispatch to Scheduler");
    }
  }

  // schedule a single request to a peer after finding a legal pair returns success
  scheduleOne(): boolean {
    // console.log("SCHEDULE ONE");

    for (const peer of this.peers) {
      // console.log({
      //   choking: peer.isPeerChoking,
      //   pieces: peer.pieces.size,
      // });

      if (peer.isPeerChoking) continue;
      if (peer.inFlight >= this.MAX_IN_FLIGHT) continue;

      for (const pieceIdx of peer.pieces) {
        const neededBlocks = this.pieceManager.getNeededBlocks(pieceIdx);

        // console.log({
        //   pieceIdx,
        //   neededBlocks: neededBlocks.length,
        // });

        if (neededBlocks.length === 0) continue;

        for (const { pieceIdx, offset, length } of neededBlocks) {
          const key = `${pieceIdx},${offset}`;

          if (this.requestedBlocks.has(key)) continue;

          // console.log("🚀 REQUESTING", {
          //   peer,
          //   pieceIdx,
          //   offset,
          //   length,
          // });

          this.requestedBlocks.set(key, peer);
          peer.request({ pieceIdx, offset, length });

          return true;
        }
      }
    }

    // console.log("❌ scheduleOne found nothing");
    return false;
  }

  schedule() {
    while (this.scheduleOne()) {}
  }

  public dispatch(event: SchedulerEvent) {
    this.eventQueue.push(event);
  }
}
