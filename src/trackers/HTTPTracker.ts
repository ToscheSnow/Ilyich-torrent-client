import type { BencodeDict } from "../types/parserTypes";
import type { PeerAddress } from "../peers/PeerManager";
import type { Recon } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";
import { BencodeDecoder } from "../fileParsing/parserDecoder";
import {
  parseCompactIPv6Peers,
  parsePeerAddress,
} from "../fileParsing/parsePeerAddress";
import { httpTrackerQuery } from "./trackerURL";
import type { TransferStats } from "../utils/Stats";

export type TrackerResponse = {
  peers: PeerAddress[];
  interval: number;
};

export type TrackerAnnounceArgs = {
  infoHash: Buffer;
  peerId: Buffer;
  port: number;
};

export class HttpTracker {
  private announceTimer?: ReturnType<typeof setInterval>;
  private failedTrackers: Set<string> = new Set<string>();

  constructor(
    private readonly urls: string[],
    private readonly args: TrackerAnnounceArgs,
    private getTransferStats: () => TransferStats,
    private onResponse: (peersAddresses: PeerAddress[]) => void,
    private recon: Recon<TorrentEvents>,
  ) {
    if (this.urls.length === 0) {
      console.log("No HTTP trackers found in torrent");
    }

    this.recon.once("DOWNLOAD_COMPLETE", () => {
      console.log("📦 Disconnect HTTP TRACKER");
      this.disconnect();
    });
  }

  private disconnect() {
    clearInterval(this.announceTimer);
  }

  public async announce() {
    // send requests to tracker at the same time
    const fetchSingleReq = async (url: string) => {
      if (this.failedTrackers.has(url)) return;
      try {
        const response = await this.requestTracker(url);
        this.onResponse(response.peers);
      } catch (err) {
        this.failedTrackers.add(url);
        const message = err instanceof Error ? err.message : String(err);
        // console.error(`Tracker failed :${url} - ${message}`);
      }
    };

    this.announceTimer = setInterval(async () => {
      console.log("🎯 Sent HTTP Tracker Req");
      await Promise.allSettled(this.urls.map((url) => fetchSingleReq(url)));
      console.log(`😨 Failed HTTP Tracker count: ${this.failedTrackers.size}`);
    }, 120 * 1000);

    await Promise.allSettled(this.urls.map((url) => fetchSingleReq(url)));
    console.log(`😨 Failed HTTP Tracker count: ${this.failedTrackers.size}`);
  }

  private async requestTracker(trackerUrl: string): Promise<TrackerResponse> {
    const { downloaded, uploaded, left } = this.getTransferStats();
    const url = httpTrackerQuery(
      {
        urlPath: trackerUrl,
        infoHash: this.args.infoHash,
        clientPort: this.args.port,
        uploaded,
        totalBytes: left,
        downloaded,
      },
      left === 0 ? "completed" : undefined,
    );

    const response = await fetch(url);

    console.log(`URL ${url.slice(0, 35)} Status: ${response.status}`);

    if (!response.ok) {
      const body = await response.text();

      throw new Error(
        `Tracker responded with HTTP ${response.status}: ${body.slice(0, 25)}`,
      );
    }

    const responseBytes = Buffer.from(await response.arrayBuffer());

    const decoder = new BencodeDecoder(responseBytes);
    const decoded = decoder.parse() as BencodeDict;

    if ("failure reason" in decoded) {
      throw new Error(String(decoded["failure reason"]));
    }

    const interval = decoded["interval"];

    if (typeof interval !== "number") {
      throw new Error("Tracker response has no interval");
    }

    const peers = decoded["peers"];
    const peers6 = decoded["peers6"];

    // trackers are supposed to honour compact=1 and return peers as a
    // single byte string - but some dont, they often bencode an EMPTY swarm as
    // an empty list rather than an empty byte string. Handle both shapes
    let parsedPeers: PeerAddress[];

    if (peers instanceof Uint8Array) {
      parsedPeers = parsePeerAddress(peers);
    } else if (Array.isArray(peers)) {
      const textDecoder = new TextDecoder();

      parsedPeers = peers.map((peerEntry) => {
        const peerDict = peerEntry as BencodeDict;

        return {
          host: textDecoder.decode(peerDict["ip"] as Uint8Array),
          port: peerDict["port"] as number,
        };
      });
    } else if (peers6 instanceof Uint8Array) {
      parsedPeers = parseCompactIPv6Peers(peers6);
    } else {
      throw new Error("Tracker response has an unrecognized peers format");
    }

    return {
      interval,
      peers: parsedPeers,
    };
  }
}
