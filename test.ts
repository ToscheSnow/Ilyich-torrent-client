import { BencodeDecoder } from "./src/fileParsing/parserDecoder";
import { readFileSync } from "node:fs";

const path = "./sampleTorrents/2001.torrent";

const decoder = new BencodeDecoder(readFileSync(path));

console.log(decoder.parse());
