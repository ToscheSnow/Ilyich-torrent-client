import type { Recon, unsubscribeFn } from "../Emitter/Recon";
import type { Peer } from "../peers/peer";
import type { TorrentEvents } from "../torrent";

export class Stats {
  private peersConnected = 0;
  private piecesCompleted = 0;
  private bytesDownloadedThisSession = 0;
  private totalBytesHave = 0;
  private lastSpeedCheckBytes = 0;
  private uploadedBytes = 0;
  private chokedPeers = new Set<Peer>();
  private seeders = new Set<Peer>();

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
    });

    this.recon.listen("PEER:DISCONNECT", (peer) => {
      this.peersConnected--;
      this.chokedPeers.delete(peer);
      this.seeders.delete(peer);
    });

    this.recon.listen("BLOCK:UPLOADED", (bytes) => {
      this.uploadedBytes += bytes;
    });

    this.recon.listen("PEER:CHOKE", (peer) => {
      this.chokedPeers.add(peer);
    });

    this.recon.listen("PEER:UNCHOKE", (peer) => {
      this.chokedPeers.delete(peer);
    });

    this.recon.listen("SEEDER:CONNECT", (peer) => {
      this.seeders.add(peer);
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
    return this.chokedPeers.size;
  }

  public speedSince(intervalMs: number): number {
    const speed =
      ((this.bytesDownloadedThisSession - this.lastSpeedCheckBytes) /
        intervalMs) *
      1000;
    this.lastSpeedCheckBytes = this.bytesDownloadedThisSession;
    return speed;
  }

  public get seedPeers(): number {
    return this.seeders.size;
  }
}
