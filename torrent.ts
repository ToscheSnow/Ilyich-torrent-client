import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ByteParser } from "./src/fileParsing/parserDecoder";
import { infoDict } from "./src/fileParsing/TorrentMetadata";
import type { BencodeDict } from "./src/types/parserTypes";

import { StorageManager } from "./src/fileAssembly/StorageManager";
import { PieceManager } from "./src/Pieces/PieceManager";
import { Scheduler } from "./src/Scheduler/scheduler";
import { PeerManager } from "./src/peers/PeerManager";
import type { Peer } from "./src/peers/peer";

import { CLIENT_ID_BYTES } from "./client";
import { Tracker } from "./src/trackers/tracker";
import { DownloadStats } from "./src/utils/DownloadStats";
import { StatsReporter } from "./src/utils/StatsReporter";

export class Torrent {
  private readonly activePeers: Set<Peer> = new Set();

  private readonly storageManager: StorageManager;
  private readonly pieceManager: PieceManager;
  private readonly scheduler: Scheduler;
  private readonly peerManager: PeerManager;
  private readonly tracker: Tracker;
  private statsReporter: StatsReporter;

  private readonly meta;
  private readonly infoHash;
  private readonly peerId = CLIENT_ID_BYTES;
  public totalBytes = 0;

  constructor(
    private readonly torrentPath: string,
    private readonly downloadDir: string = path.join(homedir(), "Downloads"),
  ) {
    const decoder = new ByteParser(readFileSync(this.torrentPath));

    const decodedTorrent = decoder.parse() as BencodeDict;

    this.meta = infoDict(decodedTorrent);
    this.infoHash = Buffer.from(this.meta.infoHash);

    this.totalBytes = this.getTotalBytes();

    this.statsReporter = new StatsReporter(
      new DownloadStats(() => this.activePeers.size),
      this.meta.pieceHashes.length / 20,
      this.meta.pieceLength,
    );

    this.storageManager = new StorageManager(this.meta, this.downloadDir);

    this.pieceManager = new PieceManager(
      this.meta,
      this.storageManager,
      this.statsReporter.getPieceIncrement,
      this.statsReporter.getByteIncrement,
    );

    this.scheduler = new Scheduler(
      this.pieceManager,
      this.activePeers,
      this.statsReporter.stop,
    );

    this.peerManager = new PeerManager(
      this.activePeers,
      // new Set<PeerAddress>(),
      this.infoHash,
      // 10,
      this.scheduler.dispatch.bind(this.scheduler),
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

    this.statsReporter.start();

    this.pieceManager.completeDownloadHandler();
  }

  private async announce() {
    const responses = await this.tracker.announce({
      infoHash: this.infoHash,
      peerId: this.peerId,
      port: 6881,
      uploaded: 0,
      downloaded: this.statsReporter.downloadedBytes, // should be what you have
      left: this.totalBytes - this.statsReporter.downloadedBytes,
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
