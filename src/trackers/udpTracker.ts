import { randomBytes } from "node:crypto";
import dgram from "node:dgram";
import { AsyncMessageQueue } from "../Queues/MessageQueue";
import { parsePeerAddress } from "../fileParsing/parsePeerAddress";
import dns from "node:dns/promises";
import type { PeerAddress } from "../peers/PeerManager";
import type { Recon } from "../Emitter/Recon";
import type { TorrentEvents } from "../torrent";
import type { TrackerEvent } from "../types/trackerTypes";
import type { TransferStats } from "../utils/Stats";
import type { TrackerAnnounceArgs } from "./httpTracker";

class SilentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SilentParseError";
  }
}

type TrackerRequest = {
  host: string;
  port: number;
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

export class UdpTracker {
  //session key allows the server to identify us if our IP changes middownload (32 bit long)
  private SESSION_KEY = randomBytes(4);
  private pendingRequests = new Map<number, TrackerRequest>();

  //UDP socket for IPv4
  private socket = dgram.createSocket("udp4");

  // maps trackers and states trackerKey = {ip},{port}
  private trackerStates = new Map<string, TrackerState>();
  private retries = new Map<number, ReturnType<typeof setTimeout>>();

  private incomingMessageQueue = new AsyncMessageQueue<TrackerEvent>();
  private outgoingMessageQueue = new AsyncMessageQueue<Datagram>();

  private failedTrackers = new Set<string>();

  private hasAnnouncedStart = false;
  private hasAnnouncedCompletion = false;

  private timer!: ReturnType<typeof setInterval>;

  constructor(
    private readonly urls: string[],
    private args: TrackerAnnounceArgs,
    private getTransferStats: () => TransferStats,
    private onResponse: (peersAddresses: PeerAddress[]) => void,
    private recon: Recon<TorrentEvents>,
  ) {
    this.socket.on("message", (message, { address, port }) => {
      try {
        const event = this.parseEventFromMessage(message, address, port);
        this.incomingMessageQueue.push(event);
      } catch (err) {
        if (err instanceof SilentParseError) return;
        if (err instanceof Error) console.log(err.message);
      }
    });

    this.socket.on("error", (err) => {
      console.log(
        `🌧️ Connection closed to UDP Tracker due to error ${err.message}`,
      );
    });

    this.recon.once("DOWNLOAD_COMPLETE", () => {
      console.log("📦 Disconnect UDP TRACKER");
      this.disconnect();
    });

    this.startIncomingLoop();
    this.startReqLoop();
  }

  private disconnect() {
    // stop processing events and socket buffers
    this.incomingMessageQueue.close();
    this.outgoingMessageQueue.close();

    // turn off retries
    for (const [_, timer] of this.retries) {
      timer.close();
    }
    this.timer.close();
    this.retries.clear();
    this.pendingRequests.clear();
    this.trackerStates.clear();

    this.socket.close();
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

  private getAnnounceEvent({ left }: TransferStats): 0 | 1 | 2 {
    if (!this.hasAnnouncedStart) {
      this.hasAnnouncedStart = true;
      return 2; // started
    }

    if (left === 0 && !this.hasAnnouncedCompletion) {
      this.hasAnnouncedCompletion = true;
      return 1; // completed
    }
    return 0; // none
  }

  private parseEventFromMessage(
    message: Buffer,
    host: string,
    port: number,
  ): TrackerEvent {
    /*
    MESSAGE ID (4 Byte) : RESPONSE TYPE
    0                   : Connect response
    1                   : Announce response
    2                   : Scrape response (Not implemented and not useful)
    3                   : Error response
    */

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
          throw new SilentParseError(
            "Received announce request of insufficient length",
          );
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

        // delete pending connect request and remove retry for connect request
        this.pendingRequests.delete(event.transactionId);
        this.retries.get(event.transactionId)?.close();
        this.retries.delete(event.transactionId);

        const trackerKey = `${event.host},${event.port}`;
        const state = this.trackerStates.get(trackerKey);
        // after a connect request is sent state changes to connecting
        if (!state || state.kind !== "CONNECTING") return;

        //successful connection store connectionID
        const newState: ConnectedState = {
          kind: "CONNECTED",
          connectionId: event.connectionId,
          expiresAt: Date.now() + 60 * 1000,
        };

        this.trackerStates.set(trackerKey, newState);
        // start fresh announce request
        this.sendAnnounceRequest(event.host, event.port, event.connectionId, 0);
        return;
      }

      case "ANNOUNCE_RESPONSE": {
        if (!this.pendingRequests.has(event.transactionId)) return;

        // delete pending announce request and remove retry for announce request
        this.pendingRequests.delete(event.transactionId);
        this.retries.get(event.transactionId)?.close();
        this.retries.delete(event.transactionId);

        const trackerKey = `${event.host},${event.port}`;
        const state = this.trackerStates.get(trackerKey);

        // announce request can only be sent if tracker is connected
        if (!state || state.kind !== "CONNECTED") return;

        //collect peers and addAddresses
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

          // if past connection window disconnect and try connecting again
          if (state.expiresAt <= Date.now()) {
            this.incomingMessageQueue.push({
              type: "DISCONNECT",
              host,
              port,
            });

            this.sendConnectRequest(host, port, 0);
            return;
          }

          // retry announce request
          const connectionId = state.connectionId;
          this.retries.delete(event.transactionId);
          this.pendingRequests.delete(event.transactionId);

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

    if (triesDone >= 5) {
      this.incomingMessageQueue.push({ type: "DISCONNECT", host, port });
      return;
    }

    const transferStats = this.getTransferStats();

    const [announceTransactionId, buf] = this.announceRequestBuffer(
      connectionId,
      this.args,
      transferStats,
      this.getAnnounceEvent(transferStats),
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
        // add jitter to exponential delay to avoid multiple retries simultaneously
        DELAY * (1 << triesDone) * (0.75 + Math.random() * 0.5),
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
        DELAY * (1 << triesDone) * (0.75 + Math.random() * 0.5),
      ),
    );

    this.outgoingMessageQueue.push({ host, port, message: buf });
  }

  private connectRequestBuffer(): [number, Buffer] {
    /*
     * Constructs a 16-byte UDP tracker connect request.
     *
     * Layout:
     *   0-7:   64-bit protocol ID (magic constant)
     *   8-11:  32-bit action (0 = connect)
     *   12-15: 32-bit transaction ID (random)
     *
     * Returns the transaction ID as a number alongside the request buffer.
     */

    const buf = Buffer.alloc(16);

    buf.writeBigUInt64BE(0x41727101980n, 0);
    buf.writeUint32BE(0, 8);

    const transactionID = randomBytes(4);
    buf.set(transactionID, 12);

    return [transactionID.readUint32BE(0), buf];
  }

  private announceRequestBuffer(
    connectionID: bigint,
    { infoHash, peerId, port }: TrackerAnnounceArgs,
    { downloaded, uploaded, left }: TransferStats,
    event: 0 | 1 | 2 | 3,
  ): [number, Buffer] {
    /*
     * Constructs a 98-byte UDP tracker announce request.
     *
     * Layout:
     *   Offset  Size      Field           Description
     *   0       8 bytes   connection_id   Connection ID from the tracker handshake
     *   8       4 bytes   action          1 (announce)
     *   12      4 bytes   transaction_id  Random identifier for matching the response
     *   16      20 bytes  info_hash       SHA-1 hash of the torrent's info dictionary
     *   36      20 bytes  peer_id         Unique identifier of this peer
     *   56      8 bytes   downloaded      Total bytes downloaded
     *   64      8 bytes   left            Bytes remaining to download
     *   72      8 bytes   uploaded        Total bytes uploaded
     *   80      4 bytes   event           2 (started)
     *   84      4 bytes   IP address      0 (default; tracker determines the IP)
     *   88      4 bytes   key             Session key used to identify this client
     *   92      4 bytes   num_want        -1 (request default number of peers)
     *   96      2 bytes   port            Port on which this peer listens
     */

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

    buf.writeUint32BE(event, 80);
    buf.writeUint32BE(0, 84);

    buf.set(this.SESSION_KEY, 88);
    buf.writeInt32BE(-1, 92);
    buf.writeUint16BE(port, 96);

    return [transactionID.readUint32BE(0), buf];
  }

  public async announce() {
    // send concurrent tracker requests
    const requestTracker = async (url: string) => {
      if (this.failedTrackers.has(url)) return;
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
      } catch {
        //add to failedTrackers to skip since most dns failure doesnt resolve
        this.failedTrackers.add(url);
      }
    };

    this.timer = setInterval(
      async () => {
        console.log("😋 Sent UDP Tracker request");
        await Promise.allSettled(this.urls.map((url) => requestTracker(url)));
        console.log(`😨 Failed UDP Tracker count: ${this.failedTrackers.size}`);
      },
      1 * 60 * 1000,
    );

    await Promise.allSettled(this.urls.map((url) => requestTracker(url)));
    console.log(`😨 Failed UDP Tracker count: ${this.failedTrackers.size}`);
  }
}
