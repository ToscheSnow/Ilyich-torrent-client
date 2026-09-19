import { BLOCK_SIZE } from "../../client";
import type { TorrentMetadata } from "../types/parserTypes";
import type { Piece } from "../types/peerTypes";
import { createHash } from "crypto";

export class PieceManager {
  private totalLength: number;
  private pieceLength: number;

  private blocks: Map<string, Buffer> = new Map<string, Buffer>();
  private hashes: Uint8Array;
  private verifiedPieces: Set<number> = new Set<number>();

  constructor({ pieceHashes, pieceLength, ...meta }: TorrentMetadata) {
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
  }

  get pieceCount(): number {
    return Math.ceil(this.totalLength / this.pieceLength);
  }

  getPieceLength(pieceIdx: number): number {
    if (pieceIdx < 0 || pieceIdx >= this.pieceCount) {
      throw new Error("Invalid piece index");
    }

    if (pieceIdx === this.pieceCount - 1) {
      return this.totalLength - pieceIdx * this.pieceLength;
    }

    return this.pieceLength;
  }

  getBlockCount(pieceIdx: number) {
    const length = this.getPieceLength(pieceIdx);

    return Math.ceil(length / BLOCK_SIZE);
  }

  getBlockLength(pieceIdx: number, offset: number): number {
    const pieceLength = this.getPieceLength(pieceIdx);

    if (offset < 0 || offset >= pieceLength) {
      throw new Error("Invalid block offset");
    }

    return Math.min(BLOCK_SIZE, pieceLength - offset);
  }

  isValidBlock(pieceIdx: number, offset: number, length: number): boolean {
    if (pieceIdx < 0 || pieceIdx >= this.pieceCount) {
      return false;
    }

    if (offset < 0 || offset >= this.getPieceLength(pieceIdx)) {
      return false;
    }

    return length === this.getBlockLength(pieceIdx, offset);
  }

  receiveBlock({ pieceIdx, offset, block }: Piece) {
    if (!this.isValidBlock(pieceIdx, offset, block.length)) {
      console.warn("Invalid piece receiveBlock");
      return;
    }

    const blockKey = `${pieceIdx},${offset}`;
    this.blocks.set(blockKey, block);
  }

  private isCompletePiece(pieceIdx: number): boolean {
    const numBlocks = this.getBlockCount(pieceIdx);

    for (let i = 0; i < numBlocks; i++) {
      if (this.blocks.get(`${pieceIdx},${i * BLOCK_SIZE}`) === undefined)
        return false;
    }
    return true;
  }

  public assemblePiece(pieceIdx: number): Buffer {
    if (!this.isCompletePiece(pieceIdx)) throw new Error("Piece isnt valid");

    let buf = Buffer.alloc(0);
    const blocks = this.getBlockCount(pieceIdx);

    for (let i = 0; i < blocks; i++) {
      const key = `${pieceIdx},${i * BLOCK_SIZE}`;
      buf = Buffer.concat([buf, this.blocks.get(key)!]);
    }

    return buf;
  }

  verifyPiece(downloadedPiece: Buffer, actualHash: Buffer): boolean {
    const pieceHash = createHash("sha1").update(downloadedPiece).digest();

    return actualHash.equals(pieceHash);
  }
}
