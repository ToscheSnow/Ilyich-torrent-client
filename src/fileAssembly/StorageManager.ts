import { mkdir, open, type FileHandle } from "fs/promises";
import type { DISKFile, TorrentMetadata } from "../types/parserTypes";
import path from "path";

export class StorageManager {
  //file : [{fileLen,startOffset,path}]
  files: DISKFile[] = [];
  private fileHandles: Map<string, FileHandle> = new Map<string, FileHandle>();
  private pieceLength: number;

  constructor(
    meta: TorrentMetadata,
    private dirPath: string,
  ) {
    this.pieceLength = meta.pieceLength;

    //single file
    if ("length" in meta) {
      this.files.push({
        startOffset: 0,
        path: [meta["name"]],
        length: meta["length"],
      });
    }
    // multiple files => files: [{fileLen,length}]
    else if ("files" in meta) {
      const files = meta["files"];

      let lastEnd = 0;
      for (let i = 0; i < files.length; i++) {
        const curr = meta["files"][i]!;
        this.files.push({
          startOffset: lastEnd,
          path: curr.path,
          length: curr.length,
        });
        lastEnd += curr.length;
      }
    }
  }

  static async create(meta: TorrentMetadata, dirPath: string) {
    const manager = new StorageManager(meta, dirPath);

    await manager.initFileHandles();

    return manager;
  }

  async close() {
    for (const fileHandle of this.fileHandles.values()) {
      await fileHandle.close();
    }

    this.fileHandles.clear();
  }

  async initFileHandles() {
    for (const { length, path: pathArr } of this.files) {
      const filePath = path.join(
        this.dirPath,
        ...pathArr.map((part) => Buffer.from(part).toString("utf8")),
      );
      const dirPath = path.dirname(filePath);

      await mkdir(dirPath, { recursive: true });
      let fileHandle;

      try {
        fileHandle = await open(filePath, "r+");
      } catch (err) {
        // file doesn't exist → create it
        fileHandle = await open(filePath, "w+");
      }

      await fileHandle.truncate(length);
      console.log("OPENED FILE:", filePath);
      this.fileHandles.set(filePath, fileHandle);

      console.log("FILE HANDLES:", [...this.fileHandles.keys()]);
    }
  }

  // file a 100 260
  //file b 260 300
  //file c 300 450

  //buffer 290 340

  async writePiece(pieceIdx: number, pieceBuf: Buffer) {
    // piece offset must be computed from the torrent's pieceLength, not
    // the fixed 16KB block size - using BLOCK_SIZE here wrote every piece
    // to the wrong byte offset for any torrent with pieceLength !== 16KB
    const pieceOffset = this.pieceLength * pieceIdx;
    const pieceEnd = pieceOffset + pieceBuf.length;

    for (const { startOffset, length, path: pathArr } of this.files) {
      //

      if (startOffset + length <= pieceOffset) continue;
      if (pieceEnd <= startOffset) continue;

      //in the interval

      const [start, end] = this.findBufferOffset(
        startOffset,
        length,
        pieceOffset,
        pieceEnd,
      );
      //write to file

      const filePath = path.join(
        this.dirPath,
        ...pathArr.map((part) => Buffer.from(part).toString("utf8")),
      );

      const fileHandle = this.fileHandles.get(filePath)!;

      await fileHandle.write(
        pieceBuf,
        start,
        end - start,
        pieceOffset + start - startOffset,
      );
      //
    }
  }

  findBufferOffset(
    fileOffset: number,
    fileLength: number,
    pieceOffset: number,
    pieceEnd: number,
  ): [number, number] {
    const l = Math.max(fileOffset, pieceOffset) - pieceOffset;
    const r = Math.min(fileOffset + fileLength, pieceEnd) - pieceOffset;

    return [l, r];
  }
}
