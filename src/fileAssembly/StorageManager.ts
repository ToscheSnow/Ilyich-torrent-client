import type { DISKFile, TorrentMetadata } from "../types/parserTypes";

export class StorageManager {
  //file : [{fileLen,startOffset,path}]
  files: DISKFile[] = [];

  constructor(
    meta: TorrentMetadata,
    private dirPath: string,
  ) {
    this.dirPath = dirPath;
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

  // file a 100 260
  //file b 260 300
  //file c 300 450

  //buffer 290 340

  writePiece(pieceIdx: number, pieceBuf: Buffer) {
    // piece goes from 16*1024*pieceIdx to 16*1024*pieceIdx+pieceBuf.length;
    const pieceOffset = 16 * 1024 * pieceIdx;
    const pieceEnd = pieceOffset + pieceBuf.length;

    for (const { startOffset, length } of this.files) {
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
