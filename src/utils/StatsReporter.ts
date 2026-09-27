import type { Recon, unsubscribeFn } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";

export class Stats {
  private peersConnected = 0;
  private piecesCompleted = 0;
  private bytesDownloadedThisSession = 0;
  private totalBytesHave = 0;
  private lastSpeedCheckBytes = 0;
  private uploadedBytes = 0;
  private chokedPeers = 0;

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
      this.recon.listen("BLOCK:RECEIVED", ({ block }) => {
        this.bytesDownloadedThisSession += block.length;
        this.totalBytesHave += block.length;
      }),
    );

    this.recon.listen("PEER:CONNECT", () => {
      this.peersConnected++;
      this.chokedPeers++;
    });

    this.recon.listen("PEER:DISCONNECT", () => {
      this.peersConnected--;
    });

    this.recon.listen("BLOCK:UPLOADED", (bytes) => {
      this.uploadedBytes += bytes;
    });

    this.recon.listen("PEER:CHOKE", () => {
      this.chokedPeers++;
    });

    this.recon.listen("PEER:UNCHOKE", () => {
      this.chokedPeers--;
    });

    this.recon.once("DOWNLOAD_COMPLETE", () => {
      // does nothing at the moment
      this.stop();

      for (const off of handlers) off();
    });
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

  public get peersChoked(): number {
    return this.chokedPeers;
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
