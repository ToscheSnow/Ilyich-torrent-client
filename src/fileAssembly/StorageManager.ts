import { mkdir, open, type FileHandle } from "fs/promises";
import type { DISKFile, TorrentMetadata } from "../types/metadataTypes";
import path from "path";

export class StorageManager {
  //file : [{fileLen,startOffset,path}]
  private files: DISKFile[] = [];
  private fileHandles: Map<string, FileHandle> = new Map<string, FileHandle>();
  private pieceLength: number;

  constructor(
    private readonly meta: TorrentMetadata,
    private dirPath: string,
  ) {
    this.pieceLength = this.meta.pieceLength;
    this.initFilePaths();
  }

  private initFilePaths() {
    if ("length" in this.meta) {
      this.files.push({
        startOffset: 0,
        path: path.join(this.dirPath, this.meta.name),
        length: this.meta["length"],
      });
    }
    // multiple files => files: [{fileLen,length}]
    else if ("files" in this.meta) {
      const files = this.meta["files"];

      let lastEnd = 0;
      for (let i = 0; i < files.length; i++) {
        const curr = this.meta["files"][i]!;
        this.files.push({
          startOffset: lastEnd,
          path: path.join(this.dirPath, ...curr.path),
          length: curr.length,
        });
        lastEnd += curr.length;
      }
    }
  }

  async close() {
    for (const fileHandle of this.fileHandles.values()) {
      await fileHandle.close();
    }

    this.fileHandles.clear();
  }

  public async initFileHandles() {
    for (const { length, path: filePath } of this.files) {
      const parentDir = path.dirname(filePath);

      await mkdir(parentDir, { recursive: true });

      let fileHandle;

      try {
        // file exits change contents
        fileHandle = await open(filePath, "r+");
      } catch (err: any) {
        if (err.code !== "ENOENT") throw err;

        // no file => create it
        fileHandle = await open(filePath, "w+");
        await fileHandle.truncate(length);
      }

      console.log("OPENED FILE: ", filePath);
      this.fileHandles.set(filePath, fileHandle);
    }
  }

  // file a 100 260
  //file b 260 300
  //file c 300 450

  //buffer 290 340

  async writePiece(pieceIdx: number, pieceBuf: Buffer) {
    const pieceOffset = this.pieceLength * pieceIdx;
    const pieceEnd = pieceOffset + pieceBuf.length;

    for (const { startOffset, length, path: filePath } of this.files) {
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

  async readPiece(pieceIdx: number, pieceLength: number): Promise<Buffer> {
    // piece
    // 100 250

    //file x 20 100
    // file a 80 150
    //file b 150 200
    // file c 200 250
    // file d 250 900

    const buf = Buffer.alloc(pieceLength);

    // coordinates of the piece in global torrent bytes
    const pieceOffset = pieceIdx * this.pieceLength;
    const pieceEnd = pieceOffset + pieceLength;

    // half open intervals [ ) for files and torrents
    for (const {
      startOffset: fileOffset,
      path: filePath,
      length: fileLength,
    } of this.files) {
      // piece comes after the file
      if (pieceOffset >= fileOffset + fileLength) continue;
      // piece comes before the file
      if (pieceEnd <= fileOffset) continue;

      // implies curr file is a part of this piece
      const [start, end] = this.intervalIntersection(
        pieceOffset,
        pieceEnd,
        fileOffset,
        fileOffset + fileLength,
      )!;

      // with reference to the buffer
      const bufOffset = start - pieceOffset;
      const bufEnd = end - pieceOffset;

      const fileHandle = this.fileHandles.get(filePath)!;

      await fileHandle.read(
        buf,
        bufOffset,
        // with reference to the file
        bufEnd - bufOffset,
        start - fileOffset,
      );
    }
    return buf;
  }

  intervalIntersection(
    pieceStart: number,
    pieceEnd: number,
    fileStart: number,
    fileEnd: number,
  ): [number, number] {
    return [Math.max(fileStart, pieceStart), Math.min(fileEnd, pieceEnd)];
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
