import type { trackerURLParams } from "../types/trackerTypes";
import { CLIENT_ID_BYTES } from "../client";

export function httpTrackerQuery(
  {
    urlPath,
    infoHash,
    clientPort,
    uploaded,
    totalBytes,
    downloaded,
  }: trackerURLParams,
  event: "started" | "completed" | undefined,
) {
  const url = new URL(urlPath);
  function encodeBytes(bytes: Uint8Array): string {
    return [...bytes]
      .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
      .join("");
  }

  const infoHashEncoded = encodeBytes(infoHash);
  const peerIdEncoded = encodeBytes(CLIENT_ID_BYTES);

  url.searchParams.set("port", clientPort.toString());
  url.searchParams.set("uploaded", uploaded.toString());
  url.searchParams.set("downloaded", downloaded.toString());
  url.searchParams.set("left", totalBytes.toString());

  if (event) url.searchParams.set("event", event);

  return (
    `${url.origin}${url.pathname}` +
    `?info_hash=${infoHashEncoded}` +
    `&peer_id=${peerIdEncoded}&compact=1` +
    `&${url.searchParams.toString()}`
  );
}
