import { BLOCK_SIZE } from "../client";

export class PieceValidator {
  constructor(
    private totalLength: number,
    private pieceLength: number,
  ) {}

  public get pieceCount(): number {
    return Math.ceil(this.totalLength / this.pieceLength);
  }

  public getPieceLength(pieceIdx: number): number {
    if (pieceIdx < 0 || pieceIdx >= this.pieceCount) {
      throw new Error("Invalid piece index");
    }

    if (pieceIdx === this.pieceCount - 1) {
      return this.totalLength - pieceIdx * this.pieceLength;
    }

    return this.pieceLength;
  }

  public getBlockCount(pieceIdx: number) {
    const length = this.getPieceLength(pieceIdx);

    return Math.ceil(length / BLOCK_SIZE);
  }

  public getBlockLength(pieceIdx: number, offset: number): number {
    const pieceLength = this.getPieceLength(pieceIdx);

    if (offset < 0 || offset >= pieceLength) {
      throw new Error("Invalid block offset");
    }

    return Math.min(BLOCK_SIZE, pieceLength - offset);
  }

  public isValidBlock(
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
}
