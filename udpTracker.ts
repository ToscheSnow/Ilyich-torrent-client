import { randomBytes } from "node:crypto";
import type { TrackerAnnounceArgs } from "./src/trackers/tracker";
import dgram from "node:dgram";
import type { BencodeDict } from "./src/types/parserTypes";
import { AsyncMessageQueue } from "./src/Queues/MessageQueue";
import { parsePeerAddress } from "./src/fileParsing/parsePeerAddress";
import dns from "node:dns/promises";
import type { PeerAddress } from "./src/peers/PeerManager";

type TrackerRequest = {
  host: string;
  port: number;

  // action: 0 | 1 | 2 | 3;
  // delay: number;
  // retriesLeft: number;
};

type TrackerState = DisconnectedState | ConnectedState | ConnectingState;

interface DisconnectedState {
  kind: "DISCONNECTED";
  host: string;
  port: number;
}

type Datagram = {
  host: string;
  port: number;
  message: Buffer;
};

interface ConnectingState {
  kind: "CONNECTING";
}

interface ConnectedState {
  kind: "CONNECTED";
  connectionId: bigint;
  expiresAt: number;
}

type TrackerEvent =
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

export class UDPTracker {
  private SESSION_KEY = randomBytes(4);
  private pendingRequests = new Map<number, TrackerRequest>();

  private socket = dgram.createSocket("udp4");
  private trackerStates = new Map<string, TrackerState>();
  private retries = new Map<number, ReturnType<typeof setTimeout>>();

  private incomingMessageQueue: AsyncMessageQueue<TrackerEvent> =
    new AsyncMessageQueue<TrackerEvent>();

  private outgoingMessageQueue: AsyncMessageQueue<Datagram> =
    new AsyncMessageQueue<Datagram>();

  constructor(
    private decodedTorrent: BencodeDict,
    private args: TrackerAnnounceArgs,
    private onResponse: (peersAddresses: PeerAddress[]) => void,
  ) {
    this.socket.on("message", (message, { address, port }) => {
      try {
        const event = this.parseEventFromMessage(message, address, port);
        this.incomingMessageQueue.push(event);
      } catch (err) {
        if (err instanceof Error) console.log(err.message);
      }
    });

    this.socket.on("error", (err) => {
      console.log(
        `🌧️ Connection closed to UDP Tracker due to error ${err.message}`,
      );
    });

    this.startIncomingLoop();
    this.startReqLoop();
  }

  private async startIncomingLoop() {
    while (true) {
      const event = await this.incomingMessageQueue.pop();

      if (event === undefined) break;

      this.processEvent(event);
    }
  }

  private async startReqLoop() {
    while (true) {
      const req = await this.outgoingMessageQueue.pop();

      if (req === undefined) break;

      this.socket.send(req.message, req.port, req.host);
    }
  }

  private parseEventFromMessage(
    message: Buffer,
    host: string,
    port: number,
  ): TrackerEvent {
    const messageId = message.readUint32BE(0);

    switch (messageId) {
      case 0:
        if (message.length < 16) {
          throw new Error("Received connect request of insufficient length");
        }
        return {
          type: "CONNECT_RESPONSE",
          host,
          port,
          transactionId: message.readUint32BE(4),
          connectionId: message.readBigUInt64BE(8),
        };

      case 1:
        if (message.length < 20) {
          throw new Error("Received announce request of insufficient length");
        }
        return {
          type: "ANNOUNCE_RESPONSE",
          host,
          port,
          transactionId: message.readUint32BE(4),
          interval: message.readUint32BE(8),
          leechers: message.readUint32BE(12),
          seeders: message.readUint32BE(16),

          peers: Buffer.from(message.subarray(20)),
        };
      case 3:
        return {
          type: "ERROR",
          host,
          port,
          transactionId: message.readUint32BE(4),
          error: message.subarray(8).toString(),
        };

      default:
        throw new Error("invalid call to udpTracker event parser");
    }
  }

  //mutates state
  private processEvent(event: TrackerEvent) {
    switch (event.type) {
      // state for relevant tracker becomes connecting
      case "CONNECT_RESPONSE": {
        if (!this.pendingRequests.has(event.transactionId)) return;

        this.pendingRequests.delete(event.transactionId);

        this.retries.get(event.transactionId)?.close();
        this.retries.delete(event.transactionId);

        const trackerKey = `${event.host},${event.port}`;
        const state = this.trackerStates.get(trackerKey);

        if (!state || state.kind !== "CONNECTING") return;

        const newState: ConnectedState = {
          kind: "CONNECTED",
          connectionId: event.connectionId,
          expiresAt: Date.now() + 60 * 1000,
        };

        this.trackerStates.set(trackerKey, newState);
        // start announce request
        this.sendAnnounceRequest(event.host, event.port, event.connectionId, 0);
        return;
      }

      case "ANNOUNCE_RESPONSE": {
        if (!this.pendingRequests.has(event.transactionId)) return;

        this.pendingRequests.delete(event.transactionId);

        this.retries.get(event.transactionId)?.close();
        this.retries.delete(event.transactionId);

        const trackerKey = `${event.host},${event.port}`;
        const state = this.trackerStates.get(trackerKey);

        if (!state || state.kind !== "CONNECTED") return;

        console.log("UDP SEEDERS:", event.seeders);
        console.log("UDP leechers:", event.leechers);

        const peers = parsePeerAddress(event.peers);

        this.onResponse(peers);

        return;
      }

      case "REQUEST_TIMEOUT": {
        if (!this.pendingRequests.has(event.transactionId)) return;

        const { host, port } = event;
        if (event.action === "CONNECT") {
          this.pendingRequests.delete(event.transactionId);
          this.retries.delete(event.transactionId);

          // console.log(`${event.triesDone} try for connect request`);

          this.sendConnectRequest(host, port, event.triesDone);
        }

        if (event.action === "ANNOUNCE") {
          const trackerKey = `${host},${port}`;

          const state = this.trackerStates.get(trackerKey);

          this.retries.delete(event.transactionId);
          this.pendingRequests.delete(event.transactionId);

          if (!state || state.kind !== "CONNECTED") return;

          if (state.expiresAt <= Date.now()) {
            this.incomingMessageQueue.push({
              type: "DISCONNECT",
              host,
              port,
            });

            this.sendConnectRequest(host, port, 0);

            return;
          }
          const connectionId = state.connectionId;

          this.retries.delete(event.transactionId);
          this.pendingRequests.delete(event.transactionId);

          // console.log(`${event.triesDone} try for announce request`);

          this.sendAnnounceRequest(
            event.host,
            event.port,
            connectionId,
            event.triesDone,
          );
        }

        return;
      }

      case "DISCONNECT": {
        const trackerKey = `${event.host},${event.port}`;

        this.trackerStates.set(trackerKey, {
          kind: "DISCONNECTED",
          host: event.host,
          port: event.port,
        });

        return;
      }

      case "ERROR": {
        const { transactionId, error } = event;
        this.retries.delete(transactionId);
        this.pendingRequests.delete(transactionId);

        console.log(`Received error from a tracker: ${error}`);
        return;
      }
      default:
        throw new Error("Invalid call to udp tracker event processor");
    }
  }

  private sendAnnounceRequest(
    host: string,
    port: number,
    connectionId: bigint,
    triesDone: number,
  ) {
    const DELAY = 2000;

    if (triesDone >= 4) {
      this.incomingMessageQueue.push({ type: "DISCONNECT", host, port });
      return;
    }

    const [announceTransactionId, buf] = this.announceRequestBuffer(
      connectionId,
      this.args,
    );

    this.pendingRequests.set(announceTransactionId, { port, host });
    this.retries.set(
      announceTransactionId,
      setTimeout(
        () => {
          this.incomingMessageQueue.push({
            type: "REQUEST_TIMEOUT",
            action: "ANNOUNCE",
            buf,
            host,
            port,
            triesDone: triesDone + 1,
            transactionId: announceTransactionId,
          });
        },
        DELAY * (1 << triesDone),
      ),
    );
    this.outgoingMessageQueue.push({ host, port, message: buf });
  }

  private sendConnectRequest(host: string, port: number, triesDone: number) {
    const DELAY = 2000;

    if (triesDone >= 4) {
      this.incomingMessageQueue.push({ type: "DISCONNECT", host, port });
      return;
    }

    const [connectTransactionId, buf] = this.connectRequestBuffer();

    this.pendingRequests.set(connectTransactionId, { port, host });
    this.retries.set(
      connectTransactionId,
      setTimeout(
        () => {
          this.incomingMessageQueue.push({
            type: "REQUEST_TIMEOUT",
            action: "CONNECT",
            buf,
            host,
            port,
            triesDone: triesDone + 1,
            transactionId: connectTransactionId,
          });
        },
        DELAY * (1 << triesDone),
      ),
    );

    this.outgoingMessageQueue.push({ host, port, message: buf });
  }

  private connectRequestBuffer(): [number, Buffer] {
    const buf = Buffer.alloc(16);
    buf.writeBigUInt64BE(0x41727101980n, 0);

    buf.writeUint32BE(0, 8);

    const transactionID = randomBytes(4);

    buf.set(transactionID, 12);

    return [transactionID.readUint32BE(0), buf];
  }

  private getUDPTrackers(decodedTorrent: BencodeDict): string[] {
    // use a Set so a urls appearing in both announce-list and announce
    // doesn't get announced to twice😂
    const udpURLs = new Set<string>();
    const decoder = new TextDecoder();
    let udpCount = 0;

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

          if (isUDPTracker(url)) {
            udpURLs.add(url);
            udpCount++;
          }
        }
      }
    }

    console.log("UDP trackers found ", udpCount);

    // "announce" is required by the original spec but guard anyway in case
    const announceBytes = decodedTorrent["announce"] as Uint8Array | undefined;

    if (announceBytes) {
      const announce = decoder.decode(announceBytes);

      if (isUDPTracker(announce)) {
        udpURLs.add(announce);
      }
    }

    return [...udpURLs];
  }

  private announceRequestBuffer(
    connectionID: bigint,
    { infoHash, peerId, port, downloaded, uploaded, left }: TrackerAnnounceArgs,
  ): [number, Buffer] {
    const buf = Buffer.alloc(98);

    // if (connectionID.length !== 8)
    //   throw new Error("connectionID Buffer is of inappropriate length");
    if (infoHash.length !== 20)
      throw new Error("infoHash Buffer is of inappropriate length");
    if (peerId.length !== 20)
      throw new Error("peerId Buffer is of inappropriate length");

    // 64 bit connection ID
    buf.writeBigUInt64BE(connectionID, 0);

    // 32 bit action announce=1
    buf.writeUInt32BE(1, 8);

    // random transaction ID
    const transactionID = randomBytes(4);
    buf.set(transactionID, 12);

    buf.set(infoHash, 16);
    buf.set(peerId, 36);
    buf.writeBigUInt64BE(BigInt(downloaded), 56);
    buf.writeBigUInt64BE(BigInt(left), 64);
    buf.writeBigUInt64BE(BigInt(uploaded), 72);

    buf.writeUint32BE(2, 80);
    buf.writeUint32BE(0, 84);

    buf.set(this.SESSION_KEY, 88);
    buf.writeInt32BE(-1, 92);
    buf.writeUint16BE(port, 96);

    return [transactionID.readUint32BE(0), buf];
  }

  public async announce() {
    // send requests to tracker at the same time
    const urls = this.getUDPTrackers(this.decodedTorrent);

    const connect = async (url: string) => {
      let urlObj = new URL(url);
      let portStr = new URL(url).port;
      if (!portStr) return;

      const port = Number(portStr);

      try {
        if (port < 1 || port > 65535) return;

        const { address: host } = await dns.lookup(urlObj.hostname, {
          family: 4,
        });

        const trackerKey = `${host},${port}`;
        this.trackerStates.set(trackerKey, {
          kind: "CONNECTING",
        });

        this.sendConnectRequest(host, port, 0);
      } catch (err) {
        if (err instanceof Error) {
          console.log(err.name);
          console.log(err.message);
        }

        console.log(`Tracker ${url} failed`);
      }
    };

    // setInterval(
    //   () => {
    //     Promise.allSettled(urls.map((url) => connect(url)));
    //   },
    //   2 * 60 * 1000,
    // );

    Promise.allSettled(urls.map((url) => connect(url)));
  }
}
