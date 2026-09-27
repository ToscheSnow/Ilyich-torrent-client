// src/utils/stats-console.ts  (NEW FILE — no ink import anywhere)
import { memoryUsage } from "node:process";
import type { Stats } from "./StatsReporter";
import type { Recon } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";

export function startStatsUI(stats: Stats, _recon: Recon<TorrentEvents>) {
  setInterval(() => {
    const speed = stats.speedSince(1000);
    const pct = (stats.progress * 100).toFixed(1);
    const memory = memoryUsage();
    console.log(
      `Progress: ${stats.piecesCompletedCount} (${pct}%) | ` +
        `Peers: ${stats.peersConnectedCount} | ` +
        `Speed: ${(speed / 1024 ** 2).toFixed(2)}MB/s | ` +
        `RSS: ${(memory.rss / 1024 ** 2).toFixed(1)}MB | ` +
        `Heap: ${(memory.heapUsed / 1024 ** 2).toFixed(1)}MB | ` +
        `External: ${(memory.external / 1024 ** 2).toFixed(1)}MB | ` +
        `ArrayBuffers: ${(memory.arrayBuffers / 1024 ** 2).toFixed(1)}MB`,
    );
  }, 1000);
}
