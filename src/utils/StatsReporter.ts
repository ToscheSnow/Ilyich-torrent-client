import type { Recon, unsubscribeFn } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";

export class Stats {
  private peersConnected = 0;
  private piecesCompleted = 0;
  private bytesDownloadedThisSession = 0;
  private totalBytesHave = 0;
  private lastSpeedCheckBytes = 0;
  private uploadedBytes = 0;

  constructor(
    private readonly totalPieces: number,
    private recon: Recon<TorrentEvents>,
  ) {
    this.initReconHandlers();
  }

  private initReconHandlers() {
    const handlers: unsubscribeFn[] = [];

    handlers.push(
      this.recon.listen("PIECE:COMPLETED", () => {
        this.piecesCompleted++;
        // this.totalBytesHave += length;
      }),
    );
    handlers.push(
      this.recon.listen("PIECE:EXISTING", (length) => {
        this.piecesCompleted++;
        this.totalBytesHave += length;
      }),
    );

    handlers.push(
      this.recon.listen("PEER:CONNECT", () => {
        this.peersConnected++;
      }),
    );

    handlers.push(
      this.recon.listen("PEER:DISCONNECT", () => {
        this.peersConnected--;
      }),
    );

    handlers.push(
      this.recon.listen("BLOCK:RECEIVED", ({ block }) => {
        this.bytesDownloadedThisSession += block.length;
        this.totalBytesHave += block.length;
      }),
    );

    handlers.push(
      this.recon.listen("BLOCK:UPLOADED", (bytes) => {
        this.uploadedBytes += bytes;
      }),
    );

    this.recon.once("DOWNLOAD_COMPLETE", () => {
      this.stop();

      for (const off of handlers) off();
    });
  }

  public start() {
    const timer = setInterval(() => {
      console.log(
        "Progress ",
        ((this.piecesCompleted / this.totalPieces) * 100).toFixed(2),
        "% Connected",
        this.peersConnected,
      );
    }, 1000);

    return timer;
  }

  private stop() {}

  public get downloadedBytes(): number {
    return this.totalBytesHave;
  }

  public get piecesCompletedCount(): number {
    return this.piecesCompleted;
  }

  public get peersConnectedCount(): number {
    return this.peersConnected;
  }

  public get progress(): number {
    return this.piecesCompleted / this.totalPieces;
  }

  public get bytesUploaded(): number {
    return this.uploadedBytes;
  }

  public speedSince(intervalMs: number): number {
    const speed =
      ((this.bytesDownloadedThisSession - this.lastSpeedCheckBytes) /
        intervalMs) *
      1000;
    this.lastSpeedCheckBytes = this.bytesDownloadedThisSession;
    return speed;
  }
}
