import { readFileSync } from "fs";
import { ByteParser } from "../fileParsing/parserDecoder";
import { createHash } from "crypto";
import { ByteEncoder } from "../fileParsing/encoder";
import type { BencodeDict } from "../types/parserTypes";
import { validDecode } from "../utils/compareFiles";

export function getHash() {
  // read file from filesystem
  const file = readFileSync("test.torrent");
  const parser = new ByteParser(file);

  // decode into bEncodeDict using parser
  const decoded: BencodeDict = parser.parse() as BencodeDict;
  const encoder = new ByteEncoder();

  //encode only the torrent info portion using bEncodeEncoder
  const encoded = encoder.encode(decoded["info"]!);

  // check valid translation
  if (!validDecode(file, encoded))
    throw new Error("Encoded and Decoded hashes differ");

  const infoHash = createHash("sha1").update(encoded).digest();

  // return as a byte buffer, process at call site
  return infoHash;
}
