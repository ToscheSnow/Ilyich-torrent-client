import { CLIENT_ID_BYTES } from "../client";
import { handshakeBuf } from "./handshakeBuf";
import net from "node:net";
import { verifyHandshake } from "./verifyHandshake";
import type { BlockRequest, Piece } from "../types/peerTypes";
import { Peer } from "./peer";
import type { TorrentEvents } from "../torrent";
import type { Recon } from "../Emitter/Recon";
import { parseClient } from "./clientName";
import { normalizeAddr } from "./normaliseAddr";

export type PeerAddress = {
  host: string;
  port: number;
};

export class PeerManager {
  private connectingPeers: Set<string> = new Set<string>();
  private badPeers = new Set<string>();
  private supportedPeers: number = 0;
  private dhtPeers = 0;
  constructor(
    private activePeers: Set<Peer>,
    private infoHash: Buffer,
    private recon: Recon<TorrentEvents>,
    private pieceHandler: (piece: Piece, peer: Peer) => Promise<void>,
    private getBlock: (reqBlock: BlockRequest) => Promise<Buffer | undefined>,
    private getVerifiedPieces: () => {
      verifiedPiecesBitfield: Readonly<Uint8Array>;
      totalPieces: number;
    },
  ) {
    // peer manager coordinates incoming peer requests
    this.recon.listen("PEER:INCOMING_PIECE_REQUEST", async (block, peer) => {
      // const start = performance.now();

      const reqBlockBuf = await this.getBlock(block);

      // const readTime = performance.now() - start;

      // console.log(
      //   `📤 upload read: ${readTime.toFixed(2)}ms, ${block.length} bytes`,
      // );

      if (reqBlockBuf === undefined) return;

      peer.SEND_PIECE(block, reqBlockBuf);

      this.recon.announce("BLOCK:UPLOADED", block.length);
    });

    this.recon.listen("PEER:DISCONNECT", (peer) => {
      this.activePeers.delete(peer);
    });

    this.recon.listen("PEER:BAN", (peer) => {
      this.badPeers.add(normalizeAddr(peer.ip) ?? peer.ip);
    });

    // setInterval(() => {
    //   console.log(
    //     `Total friendly peers who support extensions: ${this.supportedPeers}`,
    //   );
    //   console.log(`Total friendly peers who support dht: ${this.dhtPeers}`);
    // }, 10 * 1000);
  }

  startListening(port: number) {
    const server = net.createServer((socket) => {
      if (this.badPeers.has(normalizeAddr(socket.remoteAddress) ?? "")) {
        socket.destroy();
        return;
      }
      const ourHandshake = handshakeBuf(this.infoHash, CLIENT_ID_BYTES);
      let buf = Buffer.alloc(0);

      const onHandshake = (data: Buffer) => {
        buf = Buffer.concat([buf, data]);
        if (buf.length < 68) return;

        const message = buf.subarray(0, 68);
        buf = buf.subarray(68);

        const { isSuccessful, remotePeerId } = verifyHandshake(
          ourHandshake,
          message,
        );

        if (!isSuccessful) {
          socket.destroy();
          return;
        }

        console.log(
          "🤝 INCOMING TCP peer handshake from",
          socket.remoteAddress,
          socket.remotePort,
        );

        socket.off("data", onHandshake);
        socket.write(ourHandshake); // reply with our own handshake

        const { verifiedPiecesBitfield, totalPieces } =
          this.getVerifiedPieces();

        const peer = new Peer(
          socket,
          this.recon,
          this.pieceHandler,
          totalPieces,
        );

        console.log("From Incoming peer", remotePeerId);

        peer.clientName = parseClient(remotePeerId);

        this.activePeers.add(peer);
        this.recon.announce("PEER:CONNECT", peer);

        peer.startAfterHandshake(buf, verifiedPiecesBitfield as Buffer);
      };

      socket.on("data", onHandshake);
      socket.on("error", () => socket.destroy());
    });

    server.listen(port, () => console.log(`\n🤞🏻 Listening on ${port}`));
    return server;
  }

  // will be called by TrackerManager
  addAddresses(newPeerAddresses: PeerAddress[]) {
    for (const newAddress of newPeerAddresses) {
      this.connectPeer(newAddress);
    }

    // trigger connect to new peers
  }

  connectPeer({ host, port }: PeerAddress) {
    if (this.badPeers.has(normalizeAddr(host) ?? host)) return;
    const peerKey = `${host}:${port}`;

    if (this.connectingPeers.has(peerKey)) return;

    // console.log(`Attempting TCP connection to ${host}:${port}`);

    this.connectingPeers.add(peerKey);

    const torrentHandshake = handshakeBuf(this.infoHash, CLIENT_ID_BYTES);

    const socket = net.createConnection({ host, port });

    let buf = Buffer.alloc(0);

    const onHandshake = (data: Buffer) => {
      buf = Buffer.concat([buf, data]);

      if (buf.length < 68) return;

      const message = buf.subarray(0, 68);
      buf = buf.subarray(68);

      const { isSuccessful, remotePeerId, supportsExtensions, supportsDHT } =
        verifyHandshake(torrentHandshake, message);

      if (!isSuccessful) {
        this.connectingPeers.delete(peerKey);
        socket.destroy();
        return;
      }

      // console.log(`🧩 Connected to a peer ${normalizeAddr(host)}:${port}`);

      socket.off("data", onHandshake);

      const { verifiedPiecesBitfield, totalPieces } = this.getVerifiedPieces();

      const peer = new Peer(socket, this.recon, this.pieceHandler, totalPieces);

      if (supportsExtensions) this.supportedPeers++;
      if (supportsDHT) this.dhtPeers++;

      peer.clientName = parseClient(remotePeerId);

      this.activePeers.add(peer);

      this.recon.announce("PEER:CONNECT", peer);

      // console.log(
      //   "🍑 SENT BITFIELD TO PEER:",
      //   BITFIELD_BUF(verifiedPieces, totalPieces),
      // );

      peer.startAfterHandshake(buf, verifiedPiecesBitfield as Buffer);
    };

    socket.on("connect", () => {
      // console.log(`TCP connected to ${peerKey}, sending handshake`);

      socket.write(torrentHandshake);
    });

    socket.on("data", onHandshake);

    socket.on("error", () => {
      // console.log(`❌ Connection error with ${peerKey}:`, err.message);
      this.connectingPeers.delete(peerKey);
    });

    socket.on("close", () => {
      this.connectingPeers.delete(peerKey);
      // console.log(`🔌 CLOSED ${peerKey}, hadError=${hadError}`);
    });

    socket.on("timeout", () => {
      console.log(`⏰ TIMEOUT ${peerKey}`);
    });
  }
}
