import { BLOCK_SIZE } from "../../client";
import type { TorrentMetadata } from "../types/parserTypes";
import type { BlockRequest, Piece } from "../types/peerTypes";
import { createHash } from "crypto";
import type { StorageManager } from "../fileAssembly/StorageManager";
import type { SchedulerDispatchCallback } from "../types/schedulerTypes";

export class PieceManager {
  private totalLength: number;
  private pieceLength: number;

  private blocks: Map<string, Buffer> = new Map<string, Buffer>();
  private hashes: Uint8Array;
  private verifiedPieces: Set<number> = new Set<number>();
  private SchedulerDispatch!: SchedulerDispatchCallback;
  private numPieces: number;

  public constructor(
    { pieceHashes, pieceLength, ...meta }: TorrentMetadata,
    private storageManager: StorageManager,
    private pieceStatIncrement: () => void,
    private bytesDownloadedIncrement: (downloadedBytes: number) => void,
  ) {
    this.pieceLength = pieceLength;
    this.hashes = pieceHashes;

    if ("length" in meta) {
      this.totalLength = meta.length;
    } else {
      this.totalLength = meta.files.reduce(
        (total, file) => total + file.length,
        0,
      );
    }

    this.numPieces = Math.ceil(this.totalLength / pieceLength);
  }

  //no async factory required i realised since torrent class initialises storage manager explicitly

  // public static async create(
  //   { pieceHashes, pieceLength, ...meta }: TorrentMetadata,
  //   storageManager: StorageManager,
  //   pieceStatIncrement: () => void,
  //   bytesDownloadedIncrement: (downloadedBytes: number) => void,
  // ): Promise<PieceManager> {
  //   const pieceManager = new PieceManager(
  //     { pieceHashes, pieceLength, ...meta },
  //     storageManager,
  //     pieceStatIncrement,
  //     bytesDownloadedIncrement,
  //   );

  //   await pieceManager.initAvailablePieces();
  //   return pieceManager;
  // }

  public setDispatch(dispatch: SchedulerDispatchCallback) {
    this.SchedulerDispatch = dispatch;
  }

  get pieceCount(): number {
    return Math.ceil(this.totalLength / this.pieceLength);
  }

  private getPieceLength(pieceIdx: number): number {
    if (pieceIdx < 0 || pieceIdx >= this.pieceCount) {
      throw new Error("Invalid piece index");
    }

    if (pieceIdx === this.pieceCount - 1) {
      return this.totalLength - pieceIdx * this.pieceLength;
    }

    return this.pieceLength;
  }

  private getBlockCount(pieceIdx: number) {
    const length = this.getPieceLength(pieceIdx);

    return Math.ceil(length / BLOCK_SIZE);
  }

  private getBlockLength(pieceIdx: number, offset: number): number {
    const pieceLength = this.getPieceLength(pieceIdx);

    if (offset < 0 || offset >= pieceLength) {
      throw new Error("Invalid block offset");
    }

    return Math.min(BLOCK_SIZE, pieceLength - offset);
  }

  private isValidBlock(
    pieceIdx: number,
    offset: number,
    length: number,
  ): boolean {
    if (pieceIdx < 0 || pieceIdx >= this.pieceCount) {
      return false;
    }

    if (offset < 0 || offset >= this.getPieceLength(pieceIdx)) {
      return false;
    }

    return length === this.getBlockLength(pieceIdx, offset);
  }

  public async receiveBlock(piece: Piece) {
    const { pieceIdx, offset, block } = piece;
    if (!this.isValidBlock(pieceIdx, offset, block.length)) {
      console.warn("Invalid piece receiveBlock");
      return;
    }

    if (this.verifiedPieces.has(pieceIdx)) return;

    const blockKey = `${pieceIdx},${offset}`;
    this.blocks.set(blockKey, block);
    this.SchedulerDispatch({ type: "BLOCK_RECEIVED", piece });

    if (this.isCompletePiece(pieceIdx)) {
      const assembled = this.assemblePiece(pieceIdx);

      if (
        this.verifyPiece(
          assembled,
          Buffer.from(this.hashes.subarray(pieceIdx * 20, pieceIdx * 20 + 20)),
        )
      ) {
        await this.storageManager.writePiece(pieceIdx, assembled);
        this.verifiedPieces.add(pieceIdx);
        this.pieceStatIncrement();
        this.bytesDownloadedIncrement(assembled.length);
      }
    }
  }

  private isCompletePiece(pieceIdx: number): boolean {
    const numBlocks = this.getBlockCount(pieceIdx);

    for (let i = 0; i < numBlocks; i++) {
      if (this.blocks.get(`${pieceIdx},${i * BLOCK_SIZE}`) === undefined)
        return false;
    }

    return true;
  }

  private assemblePiece(pieceIdx: number): Buffer {
    if (!this.isCompletePiece(pieceIdx)) throw new Error("Piece isnt valid");

    let buf = Buffer.alloc(0);
    const blocks = this.getBlockCount(pieceIdx);

    for (let i = 0; i < blocks; i++) {
      const key = `${pieceIdx},${i * BLOCK_SIZE}`;
      buf = Buffer.concat([buf, this.blocks.get(key)!]);
    }

    return buf;
  }

  private verifyPiece(downloadedPiece: Buffer, actualHash: Buffer): boolean {
    const pieceHash = createHash("sha1").update(downloadedPiece).digest();

    return actualHash.equals(pieceHash);
  }

  public getNeededBlocks(pieceIdx: number): BlockRequest[] {
    const numBlocks = this.getBlockCount(pieceIdx);

    const neededBlocks: BlockRequest[] = [];

    for (let i = 0; i < numBlocks; i++) {
      const blockSize = this.getBlockLength(pieceIdx, i * BLOCK_SIZE);
      const key = `${pieceIdx},${i * BLOCK_SIZE}`;
      if (!this.blocks.has(key))
        neededBlocks.push({
          pieceIdx,
          length: blockSize,
          offset: i * BLOCK_SIZE,
        });
    }
    return neededBlocks;
  }

  public async initAvailablePieces() {
    //benchmark

    const CONCURRENT_READS = 32;

    // worker function to check and verify written pieces
    const readAndVerifyPiece = async (pieceIdx: number) => {
      const pieceLen = this.getPieceLength(pieceIdx);
      const pieceBuf: Buffer = await this.storageManager.readPiece(
        pieceIdx,
        this.getPieceLength(pieceIdx),
      );

      if (
        this.verifyPiece(
          pieceBuf,
          Buffer.from(this.hashes.subarray(pieceIdx * 20, pieceIdx * 20 + 20)),
        )
      ) {
        this.verifiedPieces.add(pieceIdx);
        this.pieceStatIncrement();
        this.bytesDownloadedIncrement(pieceLen);
      }
    };

    const startTime = performance.now();

    for (
      let batchStart = 0;
      batchStart < this.numPieces;
      batchStart += CONCURRENT_READS
    ) {
      const end = Math.min(batchStart + CONCURRENT_READS, this.numPieces);

      // of the form [0,CONCURRENT_READS)
      const batch = Array.from(
        { length: end - batchStart },
        (_, i) => batchStart + i,
      );

      await Promise.all(batch.map(readAndVerifyPiece));
    }

    const end = performance.now();
    console.log(`${(end - startTime).toFixed(2)} ms`);
    console.log(`Found ${this.verifiedPieces.size} already on disk`);
  }
}
