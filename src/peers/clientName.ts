// clientName.ts
const CLIENTS: Record<string, string> = {
  qB: "qBittorrent",
  TR: "Transmission",
  UT: "µTorrent",
  UM: "µTorrent Mac",
  lt: "libtorrent",
  LT: "libtorrent",
  DE: "Deluge",
  AZ: "Vuze",
  BT: "BitTorrent",
  WW: "WebTorrent",
  WD: "WebTorrent Desktop",
  KT: "KTorrent",
  TL: "Tribler",
  BI: "BiglyBT",
  FD: "Free Download Manager",
};

export function parseClient(peerId: Buffer | null): string {
  if (!peerId) return "Unknown";
  const isAzureus = peerId[0] === 0x2d && peerId[7] === 0x2d; // '-' at both ends
  if (!isAzureus) return "Unknown";

  const code = peerId.toString("latin1", 1, 3);
  const digits = peerId.toString("latin1", 3, 7);
  const name = CLIENTS[code] ?? `Unknown (${code})`;

  // "4650" -> "4.6.5.0" -> trim trailing ".0"
  const version = digits
    .split("")
    .join(".")
    .replace(/(\.0)+$/, "");
  return `${name} ${version}`;
}
