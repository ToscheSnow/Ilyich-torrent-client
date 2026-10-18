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

export type TrackerResponse = {
  peers: PeerAddress[];
  interval: number;
};

export type TrackerAnnounceArgs = {
  infoHash: Buffer;
  peerId: Buffer;
  port: number;
  uploaded: number;
  downloaded: number;
  left: number;
};

export class HTTPTracker {
  private readonly urls: string[];
  private announceTimer?: ReturnType<typeof setInterval>;

  constructor(
    decodedTorrent: BencodeDict,
    private args: TrackerAnnounceArgs,
    private onResponse: (peersAddresses: PeerAddress[]) => void,
    private recon: Recon<TorrentEvents>,
  ) {
    this.urls = this.getTrackerAddr(decodedTorrent);

    if (this.urls.length === 0) {
      console.log("No HTTP trackers found in torrent");
    }

    this.recon.listen("DOWNLOAD_COMPLETE", () => {
      console.log("📦 Disconnect HTTP TRACKER");

      this.disconnect();
    });
  }

  private disconnect() {
    clearInterval(this.announceTimer);
  }

  private getTrackerAddr(decodedTorrent: BencodeDict): string[] {
    // use a Set so a urls appearing in both announce-list and announce
    // doesn't get announced to twice😂
    const httpUrls = new Set<string>();
    const decoder = new TextDecoder();
    let http = 0;

    // announce-list is OPTIONAL per BEP 12 - plenty of real .torrent files
    const announcers = decodedTorrent["announce-list"] as
      | Uint8Array[][]
      | undefined;

    if (announcers) {
      for (const tier of announcers) {
        for (const trackerBytes of tier) {
          const url = decoder.decode(trackerBytes);

          if (this.isHttpTracker(url)) {
            httpUrls.add(url);
            http++;
          }
        }
      }
    }

    console.log("HTTP trackers found ", http);

    // "announce" is required by the original spec but guard anyway in case
    const announceBytes = decodedTorrent["announce"] as Uint8Array | undefined;

    if (announceBytes) {
      const announce = decoder.decode(announceBytes);

      if (this.isHttpTracker(announce)) {
        httpUrls.add(announce);
      }
    }

    return [...httpUrls];
  }

  private isHttpTracker(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
  }

  public async announce() {
    // send requests to tracker at the same time
    const fetchSingleReq = async (url: string) => {
      try {
        const response = await this.announceTracker(url);
        this.onResponse(response.peers);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // console.error(`Tracker failed :${url} - ${message}`);
      }
    };

    const announceAll = () =>
      Promise.allSettled(this.urls.map((url) => fetchSingleReq(url)));

    this.announceTimer = setInterval(() => {
      console.log("😈 Announced again ");

      announceAll();
    }, 30 * 1000);

    announceAll();
  }

  private async announceTracker(trackerUrl: string): Promise<TrackerResponse> {
    const url = httpTrackerQuery({
      urlPath: trackerUrl,
      infoHash: this.args.infoHash,
      clientPort: this.args.port,
      uploaded: this.args.uploaded,
      totalBytes: this.args.left,
      downloaded: this.args.downloaded,
    });

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
