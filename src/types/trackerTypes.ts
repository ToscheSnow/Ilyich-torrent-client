export type trackerURLParams = {
  urlPath: string;
  infoHash: Uint8Array;
  clientPort: number;
  uploaded: number;
  totalBytes: number;
  downloaded: number;
};

export type TrackerEvent =
  | {
      type: "CONNECT_RESPONSE";
      host: string;
      port: number;
      transactionId: number;
      connectionId: bigint;
    }
  | {
      type: "ANNOUNCE_RESPONSE";
      host: string;
      port: number;
      transactionId: number;
      interval: number;
      seeders: number;
      leechers: number;
      peers: Buffer;
    }
  | {
      type: "REQUEST_TIMEOUT";
      action: "CONNECT" | "ANNOUNCE";
      transactionId: number;
      buf: Buffer;
      host: string;
      port: number;
      triesDone: number;
      connectionId?: bigint;
    }
  | {
      type: "DISCONNECT";
      host: string;
      port: number;
    }
  | {
      type: "ERROR";
      host: string;
      port: number;
      transactionId: number;
      error: string;
    };
