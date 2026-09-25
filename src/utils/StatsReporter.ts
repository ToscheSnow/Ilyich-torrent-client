import type { Recon, unsubscribeFn } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";

export class Stats {
  private peersConnected = 0;
  private piecesCompleted = 0;
  private bytesDownloaded = 0;

  constructor(
    private readonly totalPieces: number,
    private readonly pieceLength: number,
    private recon: Recon<TorrentEvents>,
  ) {
    this.initReconHandlers();
  }

  private initReconHandlers() {
    const handlers: unsubscribeFn[] = [];

    handlers.push(
      this.recon.listen("PIECE:VERIFIED", (_, length) => {
        this.piecesCompleted++;
        this.addDownloadedBytes(length);
      }),
    );

    handlers.push(
      this.recon.listen("PIECE:WRITTEN", (_, length) => {
        this.piecesCompleted++;
        this.addDownloadedBytes(length);
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

    this.recon.once("DOWNLOAD_COMPLETE", () => {
      this.stop();

      for (const off of handlers) off();
    });
  }

  public start() {}

  private stop() {}

  public addDownloadedBytes(bytes: number) {
    this.bytesDownloaded += bytes;
  }

  public get downloadedBytes(): number {
    return this.bytesDownloaded;
  }
}
