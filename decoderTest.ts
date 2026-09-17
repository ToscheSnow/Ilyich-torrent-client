import { ByteParser } from "./src/fileParsing/parserDecoder";
import { readFileSync, writeFileSync } from "fs";
const buf = readFileSync("2001.torrent");
const parser = new ByteParser(new Uint8Array(buf));

const decoder = new TextDecoder();

const res = parser.parse();

console.log(res);


// function toJsonSafe(value: unknown, key?: string): unknown {
//   if (value instanceof Uint8Array) {
//     if (key === "pieces") {
//       if (value.length % 20 !== 0) {
//         throw new Error(
//           `Invalid pieces length: ${value.length} (must be divisible by 20)`,
//         );
//       }

//       const pieces: string[] = [];

//       for (let i = 0; i < value.length; i += 20) {
//         pieces.push(Buffer.from(value.subarray(i, i + 20)).toString("hex"));
//       }

//       return pieces;
//     }

//     return decoder.decode(value);
//   }

//   if (Array.isArray(value)) {
//     return value.map((item) => toJsonSafe(item));
//   }

//   if (value && typeof value === "object") {
//     return Object.fromEntries(
//       Object.entries(value).map(([key, value]) => [
//         key,
//         toJsonSafe(value, key),
//       ]),
//     );
//   }

//   return value;
// }

// const json = JSON.stringify(toJsonSafe(res), null, 2);
// writeFileSync("output.txt", json, "utf-8");
