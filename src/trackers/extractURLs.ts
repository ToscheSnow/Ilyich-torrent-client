import type { BencodeDict } from "../types/parserTypes";

export function extractTrackerUrls(decodedTorrent: BencodeDict): {
  httpUrls: string[];
  udpUrls: string[];
} {
  // Sets to prevent duplicate announcements 😂
  const httpUrls = new Set<string>();
  const udpUrls = new Set<string>();
  const decoder = new TextDecoder();

  let httpCount = 0;
  let udpCount = 0;

  // Local helper functions since they are now decoupled from classes
  function isHttpTracker(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
  }

  function isUDPTracker(url: string): boolean {
    return url.startsWith("udp://");
  }

  // announce-list is OPTIONAL per BEP 12 - plenty of real .torrent files
  const announcers = decodedTorrent["announce-list"] as
    | Uint8Array[][]
    | undefined;

  if (announcers) {
    for (const tier of announcers) {
      for (const trackerBytes of tier) {
        const url = decoder.decode(trackerBytes);

        if (isHttpTracker(url)) {
          httpUrls.add(url);
          httpCount++;
        } else if (isUDPTracker(url)) {
          udpUrls.add(url);
          udpCount++;
        }
      }
    }
  }

  console.log("\nHTTP trackers found ", httpCount);
  console.log("UDP trackers found ", udpCount);

  // "announce" is required by the original spec but guard anyway in case
  const announceBytes = decodedTorrent["announce"] as Uint8Array | undefined;

  if (announceBytes) {
    const announce = decoder.decode(announceBytes);

    if (isHttpTracker(announce)) {
      httpUrls.add(announce);
    } else if (isUDPTracker(announce)) {
      udpUrls.add(announce);
    }
  }

  return {
    httpUrls: [...httpUrls],
    udpUrls: [...udpUrls],
  };
}
