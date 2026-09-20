import type { DownloadStats } from "./DownloadStats";

export class StatsReporter {
  private timer?: ReturnType<typeof setInterval>;

  private lastBytes = 0;
  private lastTime = performance.now();
  constructor(
    private downloadStats: DownloadStats,
    private totalPieces: number,
  ) {}

  report() {
    const now = performance.now();

    const currBytes = this.downloadStats.getDownloadedBytes();

    const elapsedSeconds = (now - this.lastTime) / 1000;

    const bytesPerSecond = (currBytes - this.lastBytes) / elapsedSeconds;

    const mbps = bytesPerSecond / (1024 * 1024);

    this.lastTime = now;
    this.lastBytes = currBytes;

    const downloadedPieces = this.downloadStats.getCompletedPieces();
    const pieceProgress = (downloadedPieces / this.totalPieces) * 100;

    console.log(
      `Speed ${(mbps * 8).toFixed(2)}Mbps/s | Progress ${downloadedPieces}/${this.totalPieces} downloaded | ${pieceProgress.toFixed(2)}%  |  Connected Peers ${this.downloadStats.peers}`,
    );
  }

  start() {
    this.report();

    this.timer = setInterval(() => {
      this.report();
    }, 2000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getPieceIncrement = () => {
    this.downloadStats.pieceIncrement();
  };

  getByteIncrement = (downloadedBytes: number) => {
    this.downloadStats.addDownloadedBytes(downloadedBytes);
  };
}
