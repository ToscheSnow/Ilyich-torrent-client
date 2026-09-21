import type { Peer } from "../peers/peer";
import type { PieceManager } from "../Pieces/PieceManager";
import { AsyncMessageQueue } from "../Queues/MessageQueue";
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

  // process Scheduler events async to avoid callback spaghetti
  private eventQueue: AsyncMessageQueue<SchedulerEvent> =
    new AsyncMessageQueue<SchedulerEvent>();

  // inject dependencies instead ,since Scheduler shouldnt create Objects
  constructor(
    private pieceManager: PieceManager,
    private peers: Set<Peer>,
    private downloadFinishTrigger: () => void,
  ) {
    pieceManager.setDispatch(this.dispatch);

    this.eventLoop();
  }

  // processEventLoop for checking events
  private async eventLoop() {
    while (true) {
      await this.schedulerEventTransition(await this.eventQueue.pop());
    }
  }

  public dispatch = (event: SchedulerEvent) => {
    this.eventQueue.push(event);
  };

  // reduce Scheduler events to corresponding actions
  private async schedulerEventTransition(event: SchedulerEvent) {
    switch (event.type) {
      case "PEER_CONNECTED": {
        //
        this.peers.add(event.peer);
        this.schedule();
        return;
      }
      case "DOWNLOAD_COMPLETED": {
        this.requestedBlocks.clear();
        this.downloadFinishTrigger();
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
    for (const peer of this.peers) {
      if (peer.isOverloaded || peer.isPeerChoking) continue;

      const availablePieces = peer.pieces;

      for (const pieceIdx of availablePieces) {
        const neededBlocks = this.pieceManager.getNeededBlocks(pieceIdx);

        if (neededBlocks.length === 0) continue;

        for (const { pieceIdx, offset, length } of neededBlocks) {
          if (this.requestedBlocks.has(`${pieceIdx},${offset}`)) continue;

          this.requestedBlocks.set(`${pieceIdx},${offset}`, peer);
          peer.request({ pieceIdx, offset, length });
          return true;
        }
      }
    }
    return false;
  }

  schedule() {
    while (this.scheduleOne()) {}
  }

  release(block: string) {
    this.requestedBlocks.delete(block);
  }
}
