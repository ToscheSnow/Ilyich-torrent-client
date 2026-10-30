// extract_extras.ts  →  bun run extract_extras.ts some.torrent

import { BencodeDecoder } from "./src/fileParsing/parserDecoder";
import type { BencodeDict, BencodeVal } from "./src/types/parserTypes";

// what you ALREADY handle in v1
const V1_CORE = {
  top: new Set(["announce", "announce-list", "info"]),
  info: new Set(["name", "piece length", "pieces", "length", "files"]),
  file: new Set(["length", "path"]),
};

// keys that exist in the wild, so you know what you're looking at
const KNOWN_EXTRAS: Record<string, string> = {
  "creation date": "metadata (unix timestamp)",
  comment: "metadata",
  "created by": "metadata",
  encoding: "metadata (text encoding hint)",
  "url-list": "BEP19 web seeds (HTTP/S3 mirrors)",
  httpseeds: "BEP17 HTTP seeds",
  nodes: "BEP5 DHT bootstrap nodes",
  private: "BEP27 ⚠️ changes behavior: no DHT/PEX/LSD allowed",
  source: "private-tracker tag, changes the infohash",
  md5sum: "legacy per-file checksum",
  sha1: "per-file sha1 (extension)",
  "name.utf-8": "utf-8 duplicate of name",
  "path.utf-8": "utf-8 duplicate of path",
  publisher: "metadata",
  "publisher-url": "metadata",
  attr: "BEP47 file attrs (padding/symlink/hidden/exec)",
  "symlink path": "BEP47 symlink target",
  "meta version": "v2/hybrid torrent marker",
  "file tree": "v2 file layout",
  "piece layers": "v2 merkle layers",
};

const textDec = new TextDecoder("utf-8", { fatal: true });

// make decoded values human-readable + JSON-safe
function render(v: BencodeVal): unknown {
  if (v instanceof Uint8Array) {
    try {
      return textDec.decode(v);
    } catch {
      const hex = Buffer.from(v).toString("hex");
      return `<binary ${v.length}B> ${hex.slice(0, 128)}${hex.length > 128 ? "…" : ""}`;
    }
  }
  if (Array.isArray(v)) return v.map(render);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(
      Object.entries(v).map(([k, val]) => [k, render(val as BencodeVal)]),
    );
  }
  return v; // number
}

const path = Bun.argv[2];
if (!path) {
  console.error("usage: bun run extract_extras.ts <file.torrent>");
  process.exit(1);
}

// Buffer (not bare Uint8Array) so subarray() returns Buffers and your getMeta .toString("utf-8") keeps working
const raw = Buffer.from(await Bun.file(path).arrayBuffer());
const root = new BencodeDecoder(raw).parse() as BencodeDict; // throws on trailing data too

type Extra = { where: string; key: string; label: string; value: unknown };
const extras: Extra[] = [];

function scan(dict: BencodeDict, core: Set<string>, where: string) {
  for (const [key, val] of Object.entries(dict)) {
    if (core.has(key)) continue;
    extras.push({
      where,
      key,
      label: KNOWN_EXTRAS[key] ?? "❓ UNKNOWN",
      value: render(val),
    });
  }
}

scan(root, V1_CORE.top, "top-level");

const info = root["info"] as BencodeDict;
scan(info, V1_CORE.info, "info");

if (Array.isArray(info["files"])) {
  (info["files"] as BencodeDict[]).forEach((f, i) =>
    scan(f, V1_CORE.file, `info.files[${i}]`),
  );
}

// sanity checks on the stuff you DO use
const warnings: string[] = [];
const pieces = info["pieces"] as Uint8Array;
if (pieces.length % 20 !== 0)
  warnings.push("pieces length not a multiple of 20");
if ("length" in info && "files" in info)
  warnings.push("both `length` and `files` present (invalid in v1)");
if (!("length" in info) && !("files" in info))
  warnings.push("neither `length` nor `files` present");

const totalSize =
  "length" in info
    ? (info["length"] as number)
    : (info["files"] as { length: number }[]).reduce((s, f) => s + f.length, 0);
const pieceLen = info["piece length"] as number;
const expectedPieces = Math.ceil(totalSize / pieceLen);
if (pieces.length / 20 !== expectedPieces)
  warnings.push(
    `piece count mismatch: have ${pieces.length / 20}, expected ${expectedPieces}`,
  );

// per-file extras can be thousands of rows, so show a summary by (where-type, key) in the console
const summary = new Map<string, number>();
for (const e of extras) {
  const bucket = e.where.startsWith("info.files[") ? "info.files[*]" : e.where;
  const k = `${bucket} → ${e.key}  (${e.label})`;
  summary.set(k, (summary.get(k) ?? 0) + 1);
}

const outPath = `${path}.extras.json`;
await Bun.write(
  outPath,
  JSON.stringify(
    { warnings, summary: Object.fromEntries(summary), extras },
    null,
    2,
  ),
);

console.log(`✅ wrote ${outPath}`);
console.log(`📦 ${extras.length} extra entries found`);
for (const [k, n] of summary) console.log(`  ${n}x  ${k}`);
if (warnings.length) console.log("⚠️ warnings:", warnings);

const showAll = Bun.argv.includes("--all");

// shorten long values so the terminal stays readable
function preview(v: unknown, max = 200): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > max ? `${s.slice(0, max)}… (+${s.length - max} chars)` : s;
}

console.log("\n──────── 🔎 EXTRAS ────────");

const perFileTotal = extras.filter((e) =>
  e.where.startsWith("info.files["),
).length;
let perFileShown = 0;

for (const e of extras) {
  const isPerFile = e.where.startsWith("info.files[");

  // multi-file torrents can have thousands of per-file rows, so cap them
  if (isPerFile && !showAll && perFileShown >= 10) continue;
  if (isPerFile) perFileShown++;

  console.log(`\n📍 ${e.where} → ${e.key}`);
  console.log(`   🏷️  ${e.label}`);
  console.log(`   📄 ${preview(e.value)}`);
}

if (perFileTotal > perFileShown) {
  console.log(
    `\n✂️ ${perFileTotal - perFileShown} more per-file extras hidden, rerun with --all to see them`,
  );
}
