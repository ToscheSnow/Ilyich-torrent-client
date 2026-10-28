import { homedir } from "node:os";
import path from "node:path";

import { BencodeDecoder } from "./fileParsing/parserDecoder";

import { StorageManager } from "./Storage/StorageManager";
import { PieceManager } from "./Pieces/PieceManager";
import { PeerManager } from "./peers/PeerManager";
import type { Peer } from "./peers/peer";

import { CLIENT_ID_BYTES } from "./client";
import { HTTPTracker, type TrackerAnnounceArgs } from "./trackers/HTTPTracker";
import { Stats } from "./utils/Stats";
import { Scheduler } from "./Scheduler/scheduler";
import type { BencodeDict } from "./types/parserTypes";
import { getMeta } from "./fileParsing/meta";
import type { BlockRequest, Piece } from "./types/peerTypes";
import { startStatsUI } from "./utils/stats-ui";
import { UDPTracker } from "./trackers/udpTracker";
import { Recon } from "./Emitter/Recon";
import { formatElapsedTime } from "./utils/formatTime";

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
  "PEER:BAN": [Peer];
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
    // parse torrent file to extract info dict and metadata
    const decoder = new BencodeDecoder(this.torrentFile);
    const decodedTorrent = decoder.parse() as BencodeDict;
    this.meta = getMeta(decodedTorrent);
    this.infoHash = Buffer.from(this.meta.infoHash);
    this.totalBytes = this.getTotalBytes();

    // initialise in order of dependencies
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
      this.infoHash,
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

    const args: TrackerAnnounceArgs = {
      infoHash: this.infoHash,
      peerId: this.peerId,
      port: 6881,
    };

    this.HTTPTracker = new HTTPTracker(
      decodedTorrent,
      args,
      this.stats.transferStats,
      (peerAddresses) => {
        this.peerManager.addAddresses(peerAddresses);
      },
      this.recon,
    );

    this.udpTracker = new UDPTracker(
      decodedTorrent,
      args,
      this.stats.transferStats,
      (peerAddresses) => {
        this.peerManager.addAddresses(peerAddresses);
      },
      this.recon,
    );
  }

  // this function starts the execution of download
  public async start(listenPort = 6881) {
    const downloadStartTime = performance.now();
    console.log(`\nStarted torrent at ${new Date().toLocaleTimeString()}\n`);

    this.recon.listen("DOWNLOAD_COMPLETE", () => {
      const downloadFinishTime = performance.now();
      console.log(`Finished downloading at ${new Date().toLocaleTimeString()}`);
      console.log(
        `Time taken to finish: ${formatElapsedTime(downloadFinishTime - downloadStartTime)}`,
      );

      // small delay so the stats UI can draw its final frame
      setTimeout(() => process.exit(0), 500);
    });

    // open file handles and map/allocate torrent files to disk
    await this.storageManager.initFileHandles();
    console.log("\nStorage initialised");

    // check for existing pieces on disk by comparing hashes from file offsets
    console.log("Checking disk for existing pieces");
    await this.pieceManager.verifyAvailablePieces();
    console.log("Available Pieces verified");

    //check for complete pieces already on disk
    this.pieceManager.completeDownloadHandler();

    //allow incoming peer connections (can also be skipped)
    this.peerManager.startListening(listenPort);

    startStatsUI(this.stats);

    // start tracker requests (these take place periodically)
    this.HTTPTracker.announce();
    this.udpTracker.announce();
  }

  private getTotalBytes(): number {
    if ("length" in this.meta) {
      return this.meta.length;
    }
    return this.meta.files.reduce((total, file) => total + file.length, 0);
  }
}
