export type BencodeVal =
  | number
  | string
  | BencodeVal[]
  | BencodeDict
  | Uint8Array;
export type BencodeDict = {
  [key: string]: BencodeVal;
};

export type TorrentInfo = SingleFileInfo | MultiFileInfo;

export interface BaseInfo {
  name: string;
  "piece length": number;
  pieces: Uint8Array;
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
