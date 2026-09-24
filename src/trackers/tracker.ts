import type { BencodeDict } from "../types/parserTypes";
import type { PeerAddress } from "../peers/PeerManager";
import { BencodeDecoder } from "../fileParsing/parserDecoder";
import { parsePeerAddress } from "../fileParsing/parsePeerAddress";
import { trackerURL } from "./trackerURL";

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

export class Tracker {
  private readonly urls: string[];

  constructor(decodedTorrent: BencodeDict) {
    this.urls = this.getHttpTrackers(decodedTorrent);

    if (this.urls.length === 0) {
      throw new Error("No HTTP trackers found in torrent");
    }
  }

  private getHttpTrackers(decodedTorrent: BencodeDict): string[] {
    // use a Set so a urls appearing in both announce-list and announce
    // doesn't get announced to twice😂
    const httpUrls = new Set<string>();
    const decoder = new TextDecoder();
    let udp = 0;
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
          } else udp++;
        }
      }
    }

    console.log("HTTP trackers found ", http);
    console.log("UDP trackers found", udp);

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

  public get urlsList(): readonly string[] {
    return this.urls;
  }

  public async announce(args: TrackerAnnounceArgs): Promise<TrackerResponse[]> {
    // send requests to tracker at the same time

    // const responses: TrackerResponse[] = [];

    // for (const url of this.urls) {
    //   try {
    //     const response = await this.announceTracker(url, args);
    //     responses.push(response);
    //   } catch (error) {
    //     const message = error instanceof Error ? error.message : String(error);

    //     console.error(`Tracker failed: ${url} — ${message}`);
    //   }
    // }

    // return responses;

    const responses: TrackerResponse[] = [];

    const fetchSingleReq = async (url: string, args: TrackerAnnounceArgs) => {
      try {
        const response = await this.announceTracker(url, args);
        responses.push(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        console.error(`Tracker failed :${url} - ${message}`);
      }
    };

    await Promise.all(this.urls.map((url) => fetchSingleReq(url, args)));

    return responses;
  }

  private async announceTracker(
    trackerUrl: string,
    args: TrackerAnnounceArgs,
  ): Promise<TrackerResponse> {
    const url = trackerURL({
      urlPath: trackerUrl,
      infoHash: args.infoHash,
      clientPort: args.port,
      uploaded: args.uploaded,
      totalBytes: args.left,
      downloaded: args.downloaded,
    });

    const response = await fetch(url);

    console.log(`URL ${url} Status: ${response.status}`);

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

    // trackers are supposed to honour compact=1 and return peers as a
    // single byte string - but some dont, they often bencode an EMPTY swarm as

    //
    // an empty list  rather than an empty byte string . Handle
    // both shapes instead of assuming
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
    } else {
      throw new Error("Tracker response has an unrecognized peers format");
    }

    return {
      interval,
      peers: parsedPeers,
    };
  }
}
