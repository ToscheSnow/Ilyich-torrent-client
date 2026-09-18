import type { BencodeDict } from "../types/parserTypes";

export function getHttpTrackers(decodedTorrent: BencodeDict): string[] {
  const httpUrls = [];

  let announcers = decodedTorrent["announcer-list"]! as string[][];

  const urls: string[] = announcers.map((val) => val[0]!);

  for (const url of urls) {
    if (url?.substring(0, 4) === "http") urls.push(url);
  }

  const announcerMain = decodedTorrent["announce"] as string;
  if (announcerMain.substring(0, 4) === "http") httpUrls.push(announcerMain);

  return httpUrls;
}
