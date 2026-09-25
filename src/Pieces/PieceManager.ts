import { BLOCK_SIZE } from "../client";
import type { TorrentMetadata } from "../types/metadataTypes";
import type { BlockRequest, Piece } from "../types/peerTypes";
import { createHash } from "crypto";
import type { StorageManager } from "../fileAssembly/StorageManager";
import type { Peer } from "../peers/peer";
import type { Recon } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";

export class PieceManager {
  private totalLength: number;
  private pieceLength: number;
  private downloadCompleted = false;

  private blocks: Map<string, Buffer> = new Map<string, Buffer>();
  private hashes: Uint8Array;
  private verifiedPieces: Set<number> = new Set<number>();
  private numPieces: number;

  public constructor(
    { pieceHashes, pieceLength, ...meta }: TorrentMetadata,
    private storageManager: StorageManager,
    private recon: Recon<TorrentEvents>,
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

    this.completeDownloadHandler();
  }

  public completeDownloadHandler() {
    if (this.downloadCompleted) return;

    if (this.verifiedPieces.size !== this.numPieces) return;

    this.downloadCompleted = true;
    this.recon.announce("DOWNLOAD_COMPLETE");
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

  public async receiveBlock(piece: Piece, peer: Peer) {
    const { pieceIdx, offset, block } = piece;

    if (this.verifiedPieces.has(pieceIdx)) return;

    if (!this.isValidBlock(pieceIdx, offset, block.length)) {
      console.warn("Invalid piece receiveBlock");
      return;
    }

    const blockKey = `${pieceIdx},${offset}`;

    this.blocks.set(blockKey, block);

    // const storedForPiece =
    //   this.getBlockCount(pieceIdx) - this.getNeededBlocks(pieceIdx).length;

    // console.log(
    //   `📦 stored piece=${pieceIdx} offset=${offset} | ` +
    //     `${storedForPiece}/${this.getBlockCount(pieceIdx)} blocks`,
    // );

    this.recon.announce("BLOCK:RECEIVED", piece);

    if (this.isCompletePiece(pieceIdx)) {
      const assembled = this.assemblePiece(pieceIdx);
      // console.log(`🧩 PIECE ${pieceIdx} COMPLETE`);

      if (
        !this.verifyPiece(
          assembled,
          Buffer.from(this.hashes.subarray(pieceIdx * 20, pieceIdx * 20 + 20)),
        )
      ) {
        this.clearPieceBlocks(pieceIdx);
        return;
      }
      // console.log(
      //   `🔐 PIECE ${pieceIdx} is valid hash valid=${Buffer.from(this.hashes.subarray(pieceIdx * 20, pieceIdx * 20 + 20))}`,
      // );
      await this.storageManager.writePiece(pieceIdx, assembled);
      this.verifiedPieces.add(pieceIdx);

      this.recon.announce("PIECE:COMPLETED", pieceIdx, assembled.length);

      // console.log("Written a piece to disk");
      this.clearPieceBlocks(pieceIdx);

      peer.HAVE_Req(pieceIdx);
      this.completeDownloadHandler();
      return;

      // console.log("Block didnt match hash");
    }
  }

  private isCompletePiece(pieceIdx: number): boolean {
    const numBlocks = this.getBlockCount(pieceIdx);

    for (let i = 0; i < numBlocks; i++) {
      const offset = i * BLOCK_SIZE;
      const key = `${pieceIdx},${offset}`;

      if (!this.blocks.has(key)) {
        // console.log(
        //   `❌ piece ${pieceIdx} incomplete: missing offset=${offset}`,
        // );
        return false;
      }
    }

    // console.log(`✅ piece ${pieceIdx} HAS ALL ${numBlocks} BLOCKS`);

    return true;
  }

  private assemblePiece(pieceIdx: number): Buffer {
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
    if (this.verifiedPieces.has(pieceIdx)) {
      return [];
    }

    const numBlocks = this.getBlockCount(pieceIdx);
    const neededBlocks: BlockRequest[] = [];

    for (let i = 0; i < numBlocks; i++) {
      const blockSize = this.getBlockLength(pieceIdx, i * BLOCK_SIZE);
      const key = `${pieceIdx},${i * BLOCK_SIZE}`;

      if (!this.blocks.has(key)) {
        neededBlocks.push({
          pieceIdx,
          length: blockSize,
          offset: i * BLOCK_SIZE,
        });
      }
    }

    return neededBlocks;
  }

  public async verifyAvailablePieces() {
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
        !this.verifyPiece(
          pieceBuf,
          Buffer.from(this.hashes.subarray(pieceIdx * 20, pieceIdx * 20 + 20)),
        )
      ) {
        this.clearPieceBlocks(pieceIdx);
        return;
      }

      this.verifiedPieces.add(pieceIdx);

      this.recon.announce("PIECE:COMPLETED", pieceIdx, pieceLen);
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

  private clearPieceBlocks(pieceIdx: number) {
    const blockCount = this.getBlockCount(pieceIdx);

    for (let i = 0; i < blockCount; i++) {
      this.blocks.delete(`${pieceIdx},${i * BLOCK_SIZE}`);
    }
  }

  getVerifiedPieces = (): {
    verifiedPieces: ReadonlySet<number>;
    totalPieces: number;
  } => {
    return { verifiedPieces: this.verifiedPieces, totalPieces: this.numPieces };
  };
}
