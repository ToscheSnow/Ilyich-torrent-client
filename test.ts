import { BitParser } from "./src/bencodeParser";

const input = "d3:agei21e4:name4:John5:piece5:helloe";

const bytes = new TextEncoder().encode(input);

const parser = new BitParser(bytes);

const res = parser.parse();

console.log(res);
