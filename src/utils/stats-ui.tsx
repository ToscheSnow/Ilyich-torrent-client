import { useState, useEffect } from "react";
import { Text, Box, render } from "ink";
import type { Stats } from "./StatsReporter";
import type { Recon } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";

function formatBytes(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

function formatMbps(bytesPerSecond: number): string {
  const megabits = (bytesPerSecond * 8) / 1024 ** 2;
  return `${megabits.toFixed(2)} Mbps`;
}

function App({ stats }: { stats: Stats }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      forceTick((t) => t + 1); // always changes -> always re-renders
    }, 500);
    return () => clearInterval(id);
  }, [stats]);

  const speed = stats.speedSince(500);
  const pct = (stats.progress * 100).toFixed(1);

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text color="green">
        Progress: {stats.piecesCompletedCount} pieces ({pct}%) —{" "}
        {formatBytes(stats.downloadedBytes)} total
      </Text>
      <Text color="green">
        Uploaded {formatBytes(stats.bytesUploaded)} total
      </Text>
      <Text>
        Speed: {formatMbps(speed)} — Peers: {stats.peersConnectedCount}
      </Text>
    </Box>
  );
}

export function startStatsUI(stats: Stats, recon: Recon<TorrentEvents>) {
  const { unmount } = render(<App stats={stats} />);
  // recon.once("DOWNLOAD_COMPLETE", () => unmount());
}
