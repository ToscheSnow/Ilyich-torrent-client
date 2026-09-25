import { CLIENT_ID_BYTES } from "../client";
import { handshakeBuf } from "./handshakeBuf";
import net from "node:net";
import { verifyHandshake } from "./verifyHandshake";
import type { BlockRequest, Piece } from "../types/peerTypes";
import { Peer } from "./peer";
import { BITFIELD_BUF } from "./bitfield";
import type { TorrentEvents } from "../torrent";
import type { Recon } from "../Emitter/Recon";

export type PeerAddress = {
  host: string;
  port: number;
};

export class PeerManager {
  private connectingPeers: Set<string> = new Set<string>();

  constructor(
    private activePeers: Set<Peer>,
    private infoHash: Buffer,
    private recon: Recon<TorrentEvents>,
    private pieceHandler: (piece: Piece, peer: Peer) => Promise<void>,
    private getBlock: (reqBlock: BlockRequest) => Promise<Buffer | undefined>,
    private getVerifiedPieces: () => {
      verifiedPieces: ReadonlySet<number>;
      totalPieces: number;
    },
  ) {
    // peer manager coordinates incoming peer requests
    this.recon.listen("PEER:INCOMING_PIECE_REQUEST", async (block, peer) => {
      const reqBlockBuf = await this.getBlock(block);
      if (reqBlockBuf === undefined) return;

      peer.SEND_PIECE(block, reqBlockBuf);

      this.recon.announce("BLOCK:UPLOADED", block.length);
    });

    this.recon.listen("PEER:DISCONNECT", (peer) => {
      this.activePeers.delete(peer);
    });
  }

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
      buf = Buffer.concat([buf, data]);

      if (buf.length < 68) return;

      const message = buf.subarray(0, 68);
      buf = buf.subarray(68);

      const { isSuccessful } = verifyHandshake(torrentHandshake, message);

      if (!isSuccessful) {
        this.connectingPeers.delete(peerKey);
        socket.destroy();
        return;
      }

      console.log("Connected to a peer");

      socket.off("data", onHandshake);

      this.connectingPeers.delete(peerKey);

      const peer = new Peer(socket, this.recon, this.pieceHandler);

      this.activePeers.add(peer);

      this.recon.announce("PEER:CONNECT", peer);

      const { verifiedPieces, totalPieces } = this.getVerifiedPieces();

      peer.startAfterHandshake(buf, BITFIELD_BUF(verifiedPieces, totalPieces));
    };

    socket.on("connect", () => {
      console.log(`TCP connected to ${peerKey}, sending handshake`);

      socket.write(torrentHandshake);
    });

    socket.on("data", onHandshake);

    socket.on("error", (err) => {
      console.log(`❌ Connection error with ${peerKey}:`, err.message);
      this.connectingPeers.delete(peerKey);
    });

    socket.on("close", (hadError) => {
      this.connectingPeers.delete(peerKey);
      console.log(`🔌 CLOSED ${peerKey}, hadError=${hadError}`);
    });

    socket.on("timeout", () => {
      console.log(`⏰ TIMEOUT ${peerKey}`);
    });
  }
}
