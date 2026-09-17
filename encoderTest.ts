import { ByteEncoder } from "./src/fileParsing/encoder";
import { ByteParser } from "./src/fileParsing/parserDecoder";
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "node:crypto";
const buf = readFileSync("2001.torrent");
const parser = new ByteParser(new Uint8Array(buf));

const res = parser.parse();

const originalHash = createHash("sha1").update(buf).digest();

const encoder = new ByteEncoder();

const encoded = encoder.encode(res);

writeFileSync("encodedtorrent.torrent", encoded);

const encodedHash = createHash("sha1").update(encoded).digest();

console.log(originalHash.equals(encodedHash));
