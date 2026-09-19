export type BencodeVal =
  | number
  | string
  | BencodeVal[]
  | BencodeDict
  | Uint8Array;
export type BencodeDict = {
  [key: string]: BencodeVal;
};

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

export interface DISKFile extends TorrentFile {
  startOffset: number;
}
