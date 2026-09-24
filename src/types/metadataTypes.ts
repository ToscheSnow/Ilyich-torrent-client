export type TorrentMetadata = SingleFileInfo | MultiFileInfo;

export interface BaseInfo {
  infoHash: Uint8Array;
  name: string;
  pieceLength: number;
  pieceHashes: Uint8Array;
  private?: number;
}

interface SingleFileInfo extends BaseInfo {
  length: number;
}

interface MultiFileInfo extends BaseInfo {
  files: TorrentFile[];
}

export interface TorrentFile {
  length: number;
  path: string[];
}

export type DISKFile = {
  startOffset: number;
  length: number;
  path: string;
};
