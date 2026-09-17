import { getHash } from "./src/info_hash/info_hash";
import { ByteParser } from "./src/fileParsing/parserDecoder";
import { readFileSync, writeFileSync } from "fs";
import { toJsonSafe } from "./src/utils/jsonHelper"

const urls = [
  ["http://tracker.openbittorrent.com:80/announce"],
  ["http://tracker.opentrackr.org:1337/announce"],
  ["https://tracker1.520.jp:443/announce"],
  ["https://tracker.tamersunion.org:443/announce"],
  ["https://tracker.imgoingto.icu:443/announce"],
  ["http://nyaa.tracker.wf:7777/announce"],
];

const totalBytes = "77610866994";

const CLIENT_ID = Buffer.from(
  "69206C6F766520736E6F7762756E6E6965732121",
  "hex",
);

const infoHash = getHash();

function trackerURL(path: string, infoHash: Uint8Array) {
  const url = new URL(path);
  function encodeBytes(bytes: Uint8Array): string {
    return [...bytes]
      .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
      .join("");
  }

  const infoHashEncoded = encodeBytes(infoHash);
  const peerIdEncoded = encodeBytes(CLIENT_ID);

  url.searchParams.set("port", "6811");
  url.searchParams.set("uploaded", "0");
  url.searchParams.set("downloaded", "0");
  url.searchParams.set("left", totalBytes);

  return (
    `${url.origin}${url.pathname}` +
    `?info_hash=${infoHashEncoded}` +
    `&peer_id=${peerIdEncoded}` +
    `&${url.searchParams.toString()}`
  );
}

export function parseCompactPeers(peers: Uint8Array) {
  const result = [];

  for (let i = 0; i < peers.length; i += 6) {
    const ip = [peers[i], peers[i + 1], peers[i + 2], peers[i + 3]].join(".");

    const port = (peers[i + 4]! << 8) | peers[i + 5]!;

    result.push({ ip, port });
  }

  return result;
}

const finalUrl = trackerURL(urls[0]![0]!, infoHash);

const decoder = new TextDecoder();

// const response = await fetch(finalUrl);

// console.log("status:", response.status);
// console.log("content-type:", response.headers.get("content-type"));

// const bytes = new Uint8Array(await response.arrayBuffer());
const bytes = new Uint8Array([
  100, 56, 58, 99, 111, 109, 112, 108, 101, 116, 101, 105, 51, 52, 52, 55, 101,
  49, 48, 58, 100, 111, 119, 110, 108, 111, 97, 100, 101, 100, 105, 49, 49, 53,
  54, 54, 101, 49, 48, 58, 105, 110, 99, 111, 109, 112, 108, 101, 116, 101, 105,
  57, 49, 57, 101, 56, 58, 105, 110, 116, 101, 114, 118, 97, 108, 105, 51, 54,
  49, 56, 101, 49, 50, 58, 109, 105, 110, 32, 105, 110, 116, 101, 114, 118, 97,
  108, 105, 49, 56, 48, 57, 101, 53, 58, 112, 101, 101, 114, 115, 51, 48, 48,
  58, 149, 22, 95, 130, 223, 17, 146, 70, 137, 226, 26, 225, 37, 19, 196, 136,
  26, 225, 205, 147, 16, 102, 151, 116, 146, 70, 198, 35, 184, 170, 31, 208, 34,
  184, 224, 156, 176, 11, 0, 47, 26, 225, 198, 54, 128, 138, 152, 137, 198, 44,
  129, 2, 86, 189, 198, 44, 134, 19, 113, 205, 45, 83, 145, 21, 212, 177, 62,
  169, 130, 183, 225, 209, 159, 26, 102, 165, 199, 39, 187, 13, 31, 82, 26, 225,
  81, 27, 86, 14, 212, 49, 151, 241, 171, 100, 80, 16, 185, 159, 157, 136, 26,
  225, 173, 249, 217, 7, 56, 123, 173, 239, 198, 188, 26, 225, 212, 93, 144, 3,
  186, 122, 38, 25, 53, 199, 200, 213, 37, 48, 111, 142, 228, 193, 187, 13, 240,
  226, 26, 225, 193, 56, 117, 11, 196, 55, 146, 70, 84, 5, 158, 101, 66, 234,
  146, 117, 156, 228, 185, 230, 125, 3, 231, 12, 181, 41, 202, 181, 133, 142,
  45, 134, 140, 44, 178, 51, 193, 160, 246, 188, 26, 225, 187, 15, 151, 177, 98,
  57, 169, 150, 208, 155, 209, 178, 85, 191, 61, 9, 65, 241, 187, 15, 118, 144,
  26, 225, 109, 245, 69, 215, 77, 63, 91, 193, 6, 173, 26, 225, 216, 8, 166,
  165, 26, 225, 198, 44, 139, 107, 200, 213, 31, 3, 152, 213, 228, 145, 194,
  146, 92, 85, 200, 213, 146, 70, 50, 186, 200, 213, 37, 48, 111, 144, 138, 131,
  77, 243, 184, 205, 26, 225, 195, 181, 167, 197, 26, 225, 37, 120, 137, 200,
  202, 39, 150, 228, 151, 102, 232, 159, 102, 182, 208, 183, 26, 225, 95, 44,
  43, 93, 23, 83, 187, 13, 135, 18, 26, 225, 86, 138, 80, 113, 26, 225, 101,
]);

const parser = new ByteParser(bytes);
const res = parser.parse();

const json = JSON.stringify(toJsonSafe(res), null, 2);
writeFileSync("res.txt", json, "utf-8");
