import { BLOCK_SIZE } from "../client";
import type { TorrentMetadata } from "../types/metadataTypes";
import type { BlockRequest, Piece } from "../types/peerTypes";
import type { StorageManager } from "../Storage/StorageManager";
import type { Peer } from "../peers/peer";
import type { TorrentEvents } from "../torrent";
import { formatBytes } from "../utils/stats-ui";
import { PieceValidator } from "./PieceValidator";
import type { Recon } from "../Emitter/Recon";

export class PieceManager {
  private totalLength: number;
  private downloadCompleted = false;

  private blocks: Map<number, Buffer> = new Map<number, Buffer>();
  private hashes: Uint8Array;
  private verifiedPieces: Set<number> = new Set<number>();
  private numPieces: number;
  private blocksPerPiece = 0;
  // pieceIdx -> (peer -> bytes they gave us for that piece)
  public validator: PieceValidator;
  private senders = new Map<number, Map<number, Peer>>();
  private suspects = new Map<
    number,
    Map<number, { peer: Peer; hash: string }[]>
  >();

  public constructor(
    { pieceHashes, pieceLength, ...meta }: TorrentMetadata,
    private storageManager: StorageManager,
    private recon: Recon<TorrentEvents>,
  ) {
    // this.pieceLength = pieceLength;
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

    this.blocksPerPiece = Math.ceil(pieceLength / BLOCK_SIZE);
    this.validator = new PieceValidator(this.totalLength, pieceLength);

    console.log("Piece length:", formatBytes(pieceLength));
    console.log("Piece count:", this.numPieces);

    this.completeDownloadHandler();
  }

  private fingerprint(buf: Buffer) {
    return new Bun.CryptoHasher("sha1").update(buf).digest("hex");
  }

  private recordBlock(pieceIdx: number, offset: number, peer: Peer) {
    let m = this.senders.get(pieceIdx);
    if (!m) this.senders.set(pieceIdx, (m = new Map()));
    m.set(offset, peer);
  }

  public completeDownloadHandler() {
    if (this.downloadCompleted) return;

    if (this.verifiedPieces.size !== this.numPieces) return;

    this.downloadCompleted = true;

    this.blocks.clear();

    this.recon.announce("DOWNLOAD_COMPLETE");
  }

  private failStreak = 0;

  private blamePeers(pieceIdx: number) {
    const sent = this.senders.get(pieceIdx);
    this.senders.delete(pieceIdx);
    if (!sent) return;

    // many fails in a row = probably OUR bug, don't ban anyone
    if (++this.failStreak > 20) return;

    const unique = new Set(sent.values());

    // fast path: one sender means it's definitely them
    if (unique.size === 1) {
      for (const peer of unique)
        peer.ban(`sole sender of corrupt piece ${pieceIdx}`);
      this.suspects.delete(pieceIdx);
      return;
    }

    // can't tell yet: remember what everyone sent, judge on the next good copy
    let s = this.suspects.get(pieceIdx);
    if (!s) this.suspects.set(pieceIdx, (s = new Map()));

    for (const [offset, peer] of sent) {
      const block = this.blocks.get(this.key(pieceIdx, offset));
      if (!block) continue; // must run BEFORE clearPieceBlocks
      let list = s.get(offset);
      if (!list) s.set(offset, (list = []));
      list.push({ peer, hash: this.fingerprint(block) });
    }
  }

  public receiveBlock = async (piece: Piece, peer: Peer) => {
    const { pieceIdx, offset, block } = piece;

    if (this.verifiedPieces.has(pieceIdx)) return;

    if (!this.validator.isValidBlock(pieceIdx, offset, block.length)) {
      console.warn("Invalid piece receiveBlock");
      return;
    }

    const blockKey = this.key(pieceIdx, offset);

    if (this.blocks.has(blockKey)) return;
    this.blocks.set(blockKey, Buffer.from(block));
    this.recordBlock(pieceIdx, offset, peer);

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
        this.blamePeers(pieceIdx);
        this.clearPieceBlocks(pieceIdx);
        this.recon.announce("PIECE:FAILED", pieceIdx);
        return;
      }
      this.failStreak = 0;
      this.settleSuspects(pieceIdx, assembled);
      // console.log(
      //   // `🔐 PIECE ${pieceIdx} is valid hash valid`,
      //   Buffer.from(this.hashes.subarray(pieceIdx * 20, pieceIdx * 20 + 20)),
      // );
      await this.storageManager.writePiece(pieceIdx, assembled);

      this.verifiedPieces.add(pieceIdx);
      this.senders.delete(pieceIdx);

      this.recon.announce("PIECE:COMPLETED", pieceIdx, assembled.length);

      // console.log(`Written piece ${pieceIdx} to disk`);
      this.clearPieceBlocks(pieceIdx);

      this.completeDownloadHandler();
      return;

      // console.log("Block didnt match hash");
    }
  };

  private settleSuspects(pieceIdx: number, good: Buffer) {
    const s = this.suspects.get(pieceIdx);
    this.suspects.delete(pieceIdx);
    if (!s) return;

    for (const [offset, entries] of s) {
      const goodHash = this.fingerprint(
        good.subarray(offset, offset + BLOCK_SIZE),
      );
      for (const { peer, hash } of entries) {
        if (hash !== goodHash) {
          peer.ban(`sent corrupt block ${pieceIdx}@${offset}`);
        }
      }
    }
  }

  private isCompletePiece(pieceIdx: number): boolean {
    const numBlocks = this.validator.getBlockCount(pieceIdx);

    for (let i = 0; i < numBlocks; i++) {
      const offset = i * BLOCK_SIZE;

      const key = this.key(pieceIdx, offset);
      // const key = `${pieceIdx},${offset}`;

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
    const buf = Buffer.alloc(this.validator.getPieceLength(pieceIdx));
    const blocks = this.validator.getBlockCount(pieceIdx);

    for (let i = 0; i < blocks; i++) {
      const key = this.key(pieceIdx, i * BLOCK_SIZE);
      const block = this.blocks.get(key)!;
      buf.set(block, i * BLOCK_SIZE);
    }

    return buf;
  }

  private verifyPiece(downloadedPiece: Buffer, actualHash: Buffer): boolean {
    const pieceHash = new Bun.CryptoHasher("sha1")
      .update(downloadedPiece)
      .digest();

    return actualHash.equals(pieceHash);
  }

  public getNeededBlocks(pieceIdx: number): BlockRequest[] {
    if (this.verifiedPieces.has(pieceIdx)) {
      return [];
    }

    const numBlocks = this.validator.getBlockCount(pieceIdx);
    const neededBlocks: BlockRequest[] = [];

    for (let i = 0; i < numBlocks; i++) {
      const blockSize = this.validator.getBlockLength(pieceIdx, i * BLOCK_SIZE);
      const key = this.key(pieceIdx, i * BLOCK_SIZE);

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
    const CONCURRENT_READS = 1;

    const readAndVerifyPiece = async (pieceIdx: number) => {
      const pieceLen = this.validator.getPieceLength(pieceIdx);

      const pieceBuf = await this.storageManager.readBlock(pieceIdx, pieceLen);

      const ok = this.verifyPiece(
        pieceBuf,
        Buffer.from(this.hashes.subarray(pieceIdx * 20, pieceIdx * 20 + 20)),
      );

      if (!ok) {
        this.clearPieceBlocks(pieceIdx);
        return;
      }

      this.verifiedPieces.add(pieceIdx);
      this.recon.announce("PIECE:EXISTING", pieceLen);
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
    console.log(`Took ${((end - startTime) / 1000).toFixed(2)} secs`);
    console.log(`Found ${this.verifiedPieces.size} already on disk`);
  }

  private clearPieceBlocks(pieceIdx: number) {
    const blockCount = this.validator.getBlockCount(pieceIdx);

    for (let i = 0; i < blockCount; i++) {
      this.blocks.delete(this.key(pieceIdx, i * BLOCK_SIZE));
    }
  }

  getVerifiedPieces = (): {
    verifiedPieces: ReadonlySet<number>;
    totalPieces: number;
  } => {
    return { verifiedPieces: this.verifiedPieces, totalPieces: this.numPieces };
  };

  private readCache = new Map<number, Promise<Buffer>>();

  getBlock = async ({ pieceIdx, offset, length }: BlockRequest) => {
    if (!this.verifiedPieces.has(pieceIdx)) return undefined;

    let p = this.readCache.get(pieceIdx);
    if (p) {
      this.readCache.delete(pieceIdx); // refresh LRU order
    } else {
      p = this.storageManager.readBlock(
        pieceIdx,
        this.validator.getPieceLength(pieceIdx),
      );
      p.catch(() => this.readCache.delete(pieceIdx)); // never cache failures
    }
    this.readCache.set(pieceIdx, p);

    if (this.readCache.size > 8) {
      this.readCache.delete(this.readCache.keys().next().value!);
    }

    const piece = await p;
    return piece.subarray(offset, offset + length);
  };

  public get pendingBlockCount(): number {
    return this.blocks.size;
  }

  public allOffsets(pieceIdx: number): number[] {
    if (this.verifiedPieces.has(pieceIdx)) return [];
    const offs: number[] = [];
    for (let i = this.validator.getBlockCount(pieceIdx) - 1; i >= 0; i--) {
      if (!this.blocks.has(this.key(pieceIdx, i * BLOCK_SIZE)))
        offs.push(i * BLOCK_SIZE);
    }
    return offs;
  }

  private key(pieceIdx: number, offset: number) {
    return pieceIdx * this.blocksPerPiece + offset / BLOCK_SIZE;
  }

  public get totalBytes(): number {
    return this.totalLength;
  }

  public hasBlock(pieceIdx: number, offset: number): boolean {
    return this.blocks.has(this.key(pieceIdx, offset));
  }

  public get pieceCount(): number {
    return this.numPieces;
  }

  public get partialPieceCount() {
    const seen = new Set<number>();
    for (const key of this.blocks.keys())
      seen.add(Math.floor(key / this.blocksPerPiece));
    return seen.size;
  }
}
