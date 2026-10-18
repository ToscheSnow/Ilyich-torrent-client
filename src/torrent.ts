import { homedir } from "node:os";
import path from "node:path";

import { BencodeDecoder } from "./fileParsing/parserDecoder";

import { StorageManager } from "./fileAssembly/StorageManager";
import { PieceManager } from "./Pieces/PieceManager";
import { PeerManager } from "./peers/PeerManager";
import type { Peer } from "./peers/peer";

import { CLIENT_ID_BYTES } from "./client";
import { HTTPTracker, type TrackerAnnounceArgs } from "./trackers/HTTPTracker";
import { Stats } from "./utils/StatsReporter";
import { Scheduler } from "./Scheduler/scheduler";
import type { BencodeDict } from "./types/parserTypes";
import { getMeta } from "./fileParsing/meta";
import { Recon } from "./Emitter/Recon";
import type { BlockRequest, Piece } from "./types/peerTypes";
import { startStatsUI } from "./utils/stats-ui";
import { UDPTracker } from "./trackers/udpTracker";

export type TorrentEvents = {
  "PEER:CONNECT": [Peer];
  "PEER:DISCONNECT": [Peer];
  "PEER:CHOKE": [Peer];
  "PEER:HAVE": [Peer];
  "PEER:BITFIELD": [Peer];
  "PIECE:COMPLETED": [number, number];
  "PEER:UNCHOKE": [Peer];
  DOWNLOAD_COMPLETE: [];
  "BLOCK:RECEIVED": [Piece];
  "PEER:INCOMING_PIECE_REQUEST": [BlockRequest, Peer];
  "BLOCK:UPLOADED": [number];
  "PIECE:EXISTING": [number];
  "SEEDER:CONNECT": [Peer];
  "PIECE:FAILED": [number];
};

export class Torrent {
  private readonly activePeers: Set<Peer> = new Set();

  private readonly storageManager: StorageManager;
  private readonly pieceManager: PieceManager;
  private readonly scheduler: Scheduler;
  private readonly peerManager: PeerManager;
  private readonly udpTracker: UDPTracker;
  private readonly HTTPTracker: HTTPTracker;
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
      Math.ceil(this.meta.pieceLength / (16 * 1024)),
    );

    this.peerManager = new PeerManager(
      this.activePeers,
      // new Set<PeerAddress>(),
      this.infoHash,
      // 10,
      this.recon,
      this.pieceManager.receiveBlock,
      this.pieceManager.getBlock,
      this.pieceManager.getVerifiedPieces,
    );

    this.stats = new Stats(
      this.pieceManager.pieceCount,
      this.pieceManager.totalBytes,
      this.recon,
    );

    // this.udpTracker = new HTTPTracker(decodedTorrent);
    const args: TrackerAnnounceArgs = {
      infoHash: this.infoHash,
      peerId: this.peerId,
      port: 6881,
      uploaded: this.stats.bytesUploaded,
      downloaded: this.stats.downloadedBytes, // should be what you have
      left: this.totalBytes - this.stats.downloadedBytes,
    };

    this.udpTracker = new UDPTracker(decodedTorrent, args, (peerAddresses) => {
      this.peerManager.addAddresses(peerAddresses);
    });

    this.HTTPTracker = new HTTPTracker(decodedTorrent);
  }

  public async start(listenPort = 6881) {
    console.log(`Started torrent at ${new Date().toLocaleTimeString()}`);

    await this.storageManager.initFileHandles();

    console.log("Storage initialised");

    await this.pieceManager.verifyAvailablePieces();

    console.log("Available Pieces verified");

    this.pieceManager.completeDownloadHandler();

    this.peerManager.startListening(listenPort);

    startStatsUI(this.stats, this.recon);

    this.udpTracker.announce();

    await this.HTTPannounce(listenPort);
  }

  private async HTTPannounce(
    listenPort: number,
    trackerAnnounceInterval = 1 * 30,
  ) {
    let nextInterval = Infinity;

    const args: TrackerAnnounceArgs = {
      infoHash: this.infoHash,
      peerId: this.peerId,
      port: listenPort,
      uploaded: this.stats.bytesUploaded,
      downloaded: this.stats.downloadedBytes, // should be what you have
      left: this.totalBytes - this.stats.downloadedBytes,
    };

    await this.HTTPTracker.announce(args, (response) => {
      this.peerManager.addAddresses(response.peers);

      // console.log(
      //   `Tracker returned ${response.peers.length} peers, interval=${response.interval}`,
      // );

      nextInterval = Math.min(nextInterval, response.interval);
    });

    if (nextInterval !== Infinity) {
      setTimeout(() => {
        console.log("😈 Announced again ");

        this.HTTPannounce(listenPort);
      }, trackerAnnounceInterval * 1000);
    }
  }

  private getTotalBytes(): number {
    if ("length" in this.meta) {
      return this.meta.length;
    }

    return this.meta.files.reduce((total, file) => total + file.length, 0);
  }
}
