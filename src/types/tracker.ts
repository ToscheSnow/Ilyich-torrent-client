export type trackerURLParams = {
  urlPath: string;
  infoHash: Uint8Array;
  clientPort: number;
  uploaded: number;
  totalBytes: number;
  downloaded: number;
};

export type PeerLocation = {
  ip: string;
  port: number;
};
