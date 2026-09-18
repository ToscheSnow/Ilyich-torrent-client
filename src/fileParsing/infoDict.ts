import type {
  BencodeDict,
  TorrentFile,
  TorrentInfo,
} from "../types/parserTypes";

export function infoDict(decodedTorrent: BencodeDict): TorrentInfo {
  const info = decodedTorrent["info"] as BencodeDict;

  const name = info["name"] as string;
  const pieceLength = info["piece length"] as number;
  const pieces = info["pieces"] as Uint8Array;

  //single file
  if ("length" in info) {
    return {
      name,
      "piece length": pieceLength,
      pieces,
      length: info["length"] as number,
    };
  }

  // multi-file
  return {
    name,
    "piece length": pieceLength,
    pieces,
    files: info["files"]! as unknown as TorrentFile[],
  };
}
