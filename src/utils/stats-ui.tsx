import { useState, useEffect } from "react";
import { Text, Box, render } from "ink";
import { memoryUsage } from "node:process";
import type { Stats } from "./StatsReporter";
import type { Recon } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

function formatMBs(bytesPerSecond: number): string {
  return `${(bytesPerSecond / 1e6).toFixed(2)} MB/s`; // megabit = 1e6 not 1024²
}

function formatEta(sec: number): string {
  if (!isFinite(sec)) return "--";
  if (sec === 0) return "done 🎉";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function PeerTable({ stats }: { stats: Stats }) {
  const rows = stats.topPeers(5);
  return (
    <Box flexDirection="column">
      <Text color="cyan">Top peers</Text>
      {rows.map((p) => (
        <Text key={p.addr}>
          {p.peerName.padEnd(22)} ↓ {formatMBs(p.down.rate).padStart(11)}
          {/* {"  "}↑ {formatMbps(p.up.rate).padStart(11)} */}
        </Text>
      ))}
    </Box>
  );
}

function App({ stats }: { stats: Stats }) {
  const [, forceTick] = useState(0);
  const delayMs = 500;

  useEffect(() => {
    const id = setInterval(() => {
      stats.sample(delayMs); // 👈 sample here, render stays pure
      forceTick((t) => t + 1);
    }, delayMs);
    return () => clearInterval(id);
  }, []);

  const pct = (stats.progress * 100).toFixed(1);
  const memory = memoryUsage();

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text color="whiteBright">
        Progress: {stats.piecesCompletedCount} pieces ({pct}%) —{" "}
        {formatBytes(stats.downloadedBytes)} total
      </Text>
      <Text color="green">
        Uploaded {formatBytes(stats.bytesUploaded)} total
      </Text>
      <Text color="whiteBright">Speed: {formatMBs(stats.speed)}</Text>
      <Text color="whiteBright">ETA: {formatEta(stats.etaSeconds)}</Text>
      <Text color="whiteBright">Peers: {stats.peersConnectedCount}</Text>
      <Text color="whiteBright">Choked Peers: {stats.peersChoked}</Text>
      <Text color="whiteBright">Seeders: {stats.seedPeers}</Text>
      <PeerTable stats={stats} />

      <Text color="yellowBright">
        RSS: {formatBytes(memory.rss)} | Heap: {formatBytes(memory.heapUsed)}
      </Text>
      <Text color="yellowBright">
        External: {formatBytes(memory.external)} | ArrayBuffers:{" "}
        {formatBytes(memory.arrayBuffers)}
      </Text>
    </Box>
  );
}

export function startStatsUI(stats: Stats, recon: Recon<TorrentEvents>) {
  render(<App stats={stats} />);
}
