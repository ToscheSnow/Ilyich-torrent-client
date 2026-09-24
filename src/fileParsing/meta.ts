import type { TorrentFile, TorrentMetadata } from "../types/metadataTypes";
import type { BencodeDict } from "../types/parserTypes";
import { getInfoHash } from "./info_hash";

export function getMeta(
  decodedTorrent: BencodeDict,
): Readonly<TorrentMetadata> {
  const info = decodedTorrent["info"] as BencodeDict;
  const infoHash = getInfoHash(decodedTorrent);
  const name = (info["name"] as Buffer).toString("utf-8");
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
  const rawFiles = info["files"]! as { length: number; path: Buffer[] }[];
  const files: TorrentFile[] = rawFiles.map(({ length, path }) => ({
    length,
    path: path.map((buf) => buf.toString("utf-8")),
  }));

  return {
    infoHash,
    name,
    pieceLength,
    pieceHashes,
    files,
  };
}
