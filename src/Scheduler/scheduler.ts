import { StorageManager } from "../fileAssembly/StorageManager";
import type { Peer } from "../peers/peer";
import type { PieceManager } from "../Pieces/PieceManager";
import { AsyncMessageQueue } from "../Queues/MessageQueue";
import type { Piece } from "../types/peerTypes";

//schedule blocks
//
// if peer is not choking us
// if the peer has the piece
// peer queue must is not overloaded (max fly req)
// &&
// if the piece is complete ask pieceManager
// blocks which exist in this piece
//. && not already scheduled

export type SchedulerEvent = {};

export class Scheduler {
  private scheduledBlocks: Map<string, Peer> = new Map<string, Peer>();
  private eventQueue: AsyncMessageQueue<SchedulerEvent> =
    new AsyncMessageQueue<SchedulerEvent>();

  constructor(
    private storageManager: StorageManager,
    private pieceManager: PieceManager,
    private peers: Peer[],
  ) {}

  scheduleOne(): boolean {
    for (const peer of this.peers) {
      if (peer.isOverloaded || peer.isPeerChoking) continue;

      const availablePieces = peer.pieces;

      for (const pieceIdx of availablePieces) {
        const neededBlocks = this.pieceManager.getNeededBlocks(pieceIdx);

        if (neededBlocks.length === 0) continue;

        for (const { pieceIdx, offset, length } of neededBlocks) {
          if (this.scheduledBlocks.has(`${pieceIdx},${offset}`)) continue;

          this.scheduledBlocks.set(`${pieceIdx},${offset}`, peer);
          peer.request({ pieceIdx, offset, length });
          return true;
        }
      }
    }
    return false;
  }

  schedule() {}

  onReleaseBlock({ pieceIdx, offset }: Piece) {
    this.release(`${pieceIdx},${offset}`);
    this.schedule();
  }

  release(block: string) {
    this.scheduledBlocks.delete(block);
  }
}
