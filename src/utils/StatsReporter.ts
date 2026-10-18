import type { Recon, unsubscribeFn } from "../Emitter/Recon";
import type { Peer } from "../peers/peer";
import type { TorrentEvents } from "../torrent";

export class Stats {
  private peers = new Set<Peer>();
  private piecesCompleted = 0;
  private bytesDownloadedThisSession = 0;
  private totalBytesHave = 0;
  private verifiedBytes = 0;
  private lastSpeedCheckBytes = 0;
  private emaSpeed = 0; //
  private uploadedBytes = 0;
  private chokedPeers = new Set<Peer>();
  private seeders = new Set<Peer>();

  constructor(
    private readonly totalPieces: number,
    private readonly totalBytes: number,
    private recon: Recon<TorrentEvents>,
  ) {
    this.initReconHandlers();
  }

  private initReconHandlers() {
    const handlers: unsubscribeFn[] = [];

    handlers.push(
      this.recon.listen("PIECE:COMPLETED", (_idx, length) => {
        this.piecesCompleted++;
        this.verifiedBytes += length;
      }),
    );
    handlers.push(
      this.recon.listen("PIECE:EXISTING", (length) => {
        this.piecesCompleted++;
        this.totalBytesHave += length;
        this.verifiedBytes += length;
      }),
    );
    handlers.push(
      this.recon.listen("BLOCK:RECEIVED", ({ block }) => {
        this.bytesDownloadedThisSession += block.length;
        this.totalBytesHave += block.length;
      }),
    );

    this.recon.listen("PEER:CONNECT", (peer) => this.peers.add(peer));

    this.recon.listen("PEER:DISCONNECT", (peer) => {
      this.peers.delete(peer);
      this.chokedPeers.delete(peer);
      this.seeders.delete(peer);
    });

    this.recon.listen("BLOCK:UPLOADED", (bytes) => {
      this.uploadedBytes += bytes;
    });

    this.recon.listen("PEER:CHOKE", (peer) => this.chokedPeers.add(peer));
    this.recon.listen("PEER:UNCHOKE", (peer) => this.chokedPeers.delete(peer));
    this.recon.listen("SEEDER:CONNECT", (peer) => this.seeders.add(peer));

    this.recon.once("DOWNLOAD_COMPLETE", () => {
      for (const off of handlers) off();
    });
  }

  // called ONCE per UI tick, never from render 🎯
  public sample(intervalMs: number) {
    const now = performance.now();
    for (const p of this.peers) {
      p.down.sample(now);
    }

    const inst =
      ((this.bytesDownloadedThisSession - this.lastSpeedCheckBytes) /
        intervalMs) *
      1000;
    this.lastSpeedCheckBytes = this.bytesDownloadedThisSession;
    // 250ms ticks, alpha 0.05 is roughly a 5s smoothing window 🌊
    this.emaSpeed =
      this.emaSpeed === 0 ? inst : 0.2 * inst + 0.8 * this.emaSpeed;
  }

  public get speed(): number {
    return this.emaSpeed;
  }

  public get etaSeconds(): number {
    const remaining = this.totalBytes - this.verifiedBytes;
    if (remaining <= 0) return 0;
    if (this.emaSpeed < 1) return Infinity;
    return remaining / this.emaSpeed;
  }

  public topPeers(n = 10): Peer[] {
    return [...this.peers]
      .sort((a, b) => b.down.rate - a.down.rate)
      .slice(0, n);
  }

  public get downloadedBytes() {
    return this.totalBytesHave;
  }
  public get piecesCompletedCount() {
    return this.piecesCompleted;
  }
  public get peersConnectedCount() {
    return this.peers.size;
  }
  public get progress() {
    return this.piecesCompleted / this.totalPieces;
  }
  public get bytesUploaded() {
    return this.uploadedBytes;
  }
  public get peersChoked() {
    return this.chokedPeers.size;
  }
  public get seedPeers() {
    return this.seeders.size;
  }
}
