import { homedir } from "node:os";
import path from "node:path";

import { BencodeDecoder } from "./fileParsing/parserDecoder";

import { StorageManager } from "./fileAssembly/StorageManager";
import { PieceManager } from "./Pieces/PieceManager";
import { PeerManager } from "./peers/PeerManager";
import type { Peer } from "./peers/peer";

import { CLIENT_ID_BYTES } from "./client";
import { Tracker } from "./trackers/tracker";
import { Stats } from "./utils/StatsReporter";
import { Scheduler } from "./Scheduler/scheduler";
import type { BencodeDict } from "./types/parserTypes";
import { getMeta } from "./fileParsing/meta";
import { Recon } from "./Emitter/Recon";
import type { PieceInfo } from "./types/peerTypes";

export type TorrentEvents = {
  "PEER:CONNECT": [Peer];
  "PEER:DISCONNECT": [Peer];
  "PEER:CHOKE": [Peer];
  "PEER:HAVE": [Peer];
  "PEER:BITFIELD": [Peer];
  "PIECE:WRITTEN": [number, number];
  DOWNLOAD_COMPLETE: [];
  "BLOCK:RECEIVED": [PieceInfo];
  "PIECE:VERIFIED": [number, number];
};

export class Torrent {
  private readonly activePeers: Set<Peer> = new Set();

  private readonly storageManager: StorageManager;
  private readonly pieceManager: PieceManager;
  private readonly scheduler: Scheduler;
  private readonly peerManager: PeerManager;
  private readonly tracker: Tracker;
  private stats: Stats;

  private readonly meta;
  private readonly infoHash;
  private readonly peerId = CLIENT_ID_BYTES;
  public totalBytes = 0;
  private recon = new Recon<TorrentEvents>();

  constructor(
    private readonly torrentFile: Buffer,
    private readonly downloadDir: string = path.join(homedir(), "Downloads"),
  ) {
    const decoder = new BencodeDecoder(this.torrentFile);

    const decodedTorrent = decoder.parse() as BencodeDict;

    this.meta = getMeta(decodedTorrent);
    this.infoHash = Buffer.from(this.meta.infoHash);

    this.totalBytes = this.getTotalBytes();

    this.stats = new Stats(
      this.meta.pieceHashes.length / 20,
      this.meta.pieceLength,
      this.recon,
    );

    this.storageManager = new StorageManager(this.meta, this.downloadDir);

    this.pieceManager = new PieceManager(
      this.meta,
      this.storageManager,
      this.recon,
    );

    this.scheduler = new Scheduler(
      this.pieceManager,
      this.activePeers,
      this.recon,
    );

    this.peerManager = new PeerManager(
      this.activePeers,
      // new Set<PeerAddress>(),
      this.infoHash,
      // 10,
      this.recon,
      this.pieceManager.receiveBlock.bind(this.pieceManager),
      this.pieceManager.getVerifiedPieces,
    );

    this.tracker = new Tracker(decodedTorrent);
  }

  public async start() {
    console.log("Starting torrent");

    await this.storageManager.initFileHandles();
    console.log("Storage initialised");

    await this.pieceManager.verifyAvailablePieces();
    console.log("Available Pieces verified");

    this.pieceManager.completeDownloadHandler();

    await this.announce();

    this.stats.start();

    this.pieceManager.completeDownloadHandler();
  }

  private async announce() {
    const responses = await this.tracker.announce({
      infoHash: this.infoHash,
      peerId: this.peerId,
      port: 6881,
      uploaded: 0,
      downloaded: this.stats.downloadedBytes, // should be what you have
      left: this.totalBytes - this.stats.downloadedBytes,
    });

    console.log("Sent req to tracker");

    let nextInterval = Infinity;

    for (const response of responses) {
      this.peerManager.addAddresses(response.peers);

      console.log(
        `Tracker returned ${response.peers.length} peers, interval=${response.interval}`,
      );

      nextInterval = Math.min(nextInterval, response.interval);
    }

    if (nextInterval !== Infinity) {
      setTimeout(() => void this.announce(), nextInterval * 1000);
    }
  }

  private getTotalBytes(): number {
    if ("length" in this.meta) {
      return this.meta.length;
    }

    return this.meta.files.reduce((total, file) => total + file.length, 0);
  }
}
