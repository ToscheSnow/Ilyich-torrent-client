import { readFileSync } from "fs";
import { ByteParser } from "../fileParsing/parserDecoder";
import { createHash } from "crypto";
import { ByteEncoder } from "../fileParsing/encoder";
import type { BencodeDict } from "../types/parserTypes";

export function getHash() {
  // read file from filesystem
  const file = readFileSync("test.torrent");
  const parser = new ByteParser(file);

  // decode into bEncodeDict using parser
  const decoded: BencodeDict = parser.parse() as BencodeDict;
  const encoder = new ByteEncoder();

  //encode only the torrent info portion using bEncodeEncoder
  const encoded = encoder.encode(decoded["info"]!);

  const infoHash = createHash("sha1").update(encoded).digest();

  //format output to copy off the terminal pad with 0 to ensure letters since a => 0x0a and not 0xa
  return infoHash;
}
