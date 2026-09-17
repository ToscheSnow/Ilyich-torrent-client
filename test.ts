import { BitParser } from "./src/bencodeParser";
import { readFileSync, writeFileSync } from "fs";
const buf = readFileSync("test.torrent");
const parser = new BitParser(new Uint8Array(buf));

const res = parser.parse();

function toJsonSafe(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      type: "bytes",
      hex: Buffer.from(value).toString("hex"),
    };
  }

  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [key, toJsonSafe(value)]),
    );
  }

  return value;
}

const json = JSON.stringify(toJsonSafe(res), null, 2);
writeFileSync("output.txt", json, "utf-8");

console.log(res);
