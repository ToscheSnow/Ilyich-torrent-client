import { getHash } from "./info_hash";
import type {
  BencodeDict,
  TorrentFile,
  TorrentMetadata,
} from "../types/parserTypes";

export function infoDict(decodedTorrent: BencodeDict): TorrentMetadata {
  const info = decodedTorrent["info"] as BencodeDict;
  const infoHash = getHash(decodedTorrent);
  const name = info["name"] as string;
  const pieceLength = info["piece length"] as number;
  const pieceHashes = info["pieces"] as Uint8Array;

  //single file
  if ("length" in info) {
    return {
      name,
      pieceLength,
      pieceHashes,
      length: info["length"] as number,
      infoHash,
    };
  }

  // multi-file
  return {
    infoHash,
    name,
    pieceLength,
    pieceHashes,
    files: info["files"]! as unknown as TorrentFile[],
  };
}
