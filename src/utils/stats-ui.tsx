import { useState, useEffect } from "react";
import { Text, Box, render } from "ink";
import type { Stats } from "./StatsReporter";
import type { Recon } from "../Emitter/Recon"
import type { TorrentEvents } from "../torrent"

function formatBytes(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

function App({ stats }: { stats: Stats }) {
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setSpeed(stats.speedSince(500));
    }, 500);
    return () => clearInterval(id);
  }, [stats]);

  const pct = (stats.progress * 100).toFixed(1);

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text color="green">
        Progress: {stats.piecesCompletedCount} pieces ({pct}%) —{" "}
        {formatBytes(stats.downloadedBytes)} total
      </Text>
      <Text>
        Speed: {formatBytes(speed)}/s — Peers: {stats.peersConnectedCount}
      </Text>
    </Box>
  );
}

export function startStatsUI(stats: Stats, recon: Recon<TorrentEvents>) {
  const { unmount } = render(<App stats={stats} />);
  recon.once("DOWNLOAD_COMPLETE", () => unmount());
}