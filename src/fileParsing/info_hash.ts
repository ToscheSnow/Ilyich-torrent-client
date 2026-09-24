import { createHash } from "crypto";
import { BencodeEncoder } from "./encoder";
import type { BencodeDict } from "../types/parserTypes";

export function getInfoHash(decodedTorrent: BencodeDict): Buffer {
  // encoder to encode info dict
  const encoder = new BencodeEncoder();
  //encode only the torrent info portion using bEncodeEncoder
  const encoded = encoder.encode(decodedTorrent["info"]!);
  const infoHash = createHash("sha1").update(encoded).digest();

  // return as a byte buffer, process at call site
  return infoHash;
}
