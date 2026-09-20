import { CLIENT_ID_BYTES } from "../../client";
import { handshakeBuf } from "./handshakeBuf";
import net from "node:net";
import { verifyHandshake } from "./verifyHandshake";
import type { SchedulerDispatchCallback } from "../types/schedulerTypes";
import type { PeerState, Piece } from "../types/peerTypes";
import { Peer } from "./peer";

export type PeerAddress = {
  host: string;
  port: number;
};

export class PeerManager {
  //currently active Peer connections , will be used by the Scheduler

  private connectingPeers: Set<string> = new Set<string>();

  constructor(
    private activePeers: Set<Peer>,
    private peerAddresses: Set<PeerAddress>,
    private infoHash: Buffer,
    private maxConnecting = 10,
    private schedulerDispatch: SchedulerDispatchCallback,
    private pieceHandler: (piece: Piece) => Promise<void>,
  ) {}

  // will be called by TrackerManager
  addAddresses(newPeerAddresses: PeerAddress[]) {
    for (const newAddress of newPeerAddresses) {
      this.connectPeer(newAddress);
    }

    // trigger connect to new peers
  }

  connectPeer(peerAddress: PeerAddress) {
    const { host, port } = peerAddress;
    const peerKey = `${host}:${port}`;
    if (this.connectingPeers.has(peerKey)) return;

    console.log(`Attempting TCP connection to ${host}:${port}`);

    this.connectingPeers.add(peerKey);

    const torrentHandshake = handshakeBuf(this.infoHash, CLIENT_ID_BYTES);

    const socket = net.createConnection({ host, port });

    let buf = Buffer.alloc(0);

    const onHandshake = (data: Buffer) => {
      console.log(
        `📥 DATA ${peerKey}: ${data.length} bytes`,
        data.toString("hex"),
      );
      buf = Buffer.concat([buf, data]);

      if (buf.length < 68) return;

      const message = buf.subarray(0, 68);
      buf = buf.subarray(68);

      // verifyHandshake returns { isSuccessful, remotePeerId } - it's an
      // object, not a boolean, so `!verifyHandshake(...)` was always false
      // and no handshake was ever actually rejected. Destructure the flag.
      const { isSuccessful } = verifyHandshake(torrentHandshake, message);

      if (!isSuccessful) {
        this.connectingPeers.delete(peerKey);
        socket.destroy();
        return;
      }

      console.log("Connected to a peer");

      socket.off("data", onHandshake);

      this.connectingPeers.delete(peerKey);

      const peer = new Peer(
        createDefaultPeerState(),
        socket,
        this.schedulerDispatch,
        this.pieceHandler,
      );

      this.activePeers.add(peer);

      console.log("📤 Sending INTERESTED");
      peer.startAfterHandshake(buf);
    };

    socket.on("connect", () => {
      console.log(`TCP connected to ${peerKey}, sending handshake`);

      console.log(torrentHandshake.length);
      console.log(torrentHandshake.toString("hex"));
      socket.write(torrentHandshake);
    });

    socket.on("data", onHandshake);

    socket.on("error", (err) => {
      console.log(`❌ Connection error with ${peerKey}:`, err.message);
      this.connectingPeers.delete(peerKey);
    });

    socket.on("close", (hadError) => {
      console.log(`🔌 CLOSED ${peerKey}, hadError=${hadError}`);
    });

    socket.on("timeout", () => {
      console.log(`⏰ TIMEOUT ${peerKey}`);
    });
  }

  public get activePeer(): Set<Peer> {
    return this.activePeers;
  }
}

export function createDefaultPeerState(): PeerState {
  return {
    amChoking: true,
    amInterested: false,
    peerChoking: true,
    peerInterested: false,
    maxInFlight: 10,
  };
}
