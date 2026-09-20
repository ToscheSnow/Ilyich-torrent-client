import net from "node:net";
import { handshake } from "./handshake";
import { getHash } from "../fileParsing/info_hash";
import type { PeerLocation } from "../types/tracker";
import { CLIENT_ID_BYTES } from "../../client";
import { verifyHandshake } from "./verifyHandshake";
import { dispatch, type TCP_CONNECTION } from "../stateMachines/tcpState";
import { parseEventFromMessage } from "./parseEventFromMessage";
import { defaultPeerState, Peer } from "./peer";

const peerConfig: PeerLocation = {
  ip: "127.0.0.1",
  port: 6881,
};

const peer = new Peer(defaultPeerState);

const socket = net.createConnection(peerConfig);
const connection: TCP_CONNECTION = { socket, state: "CONNECTING" };

const hash = getHash();

const handshakeBuf = handshake(hash, CLIENT_ID_BYTES);

socket.on("connect", () => {
  dispatch(connection, { type: "TCP_CONNECTED" });
  console.log("Connected");
  socket.write(handshakeBuf);
  dispatch(connection, { type: "HANDSHAKE_SENT" });
});

let buf = Buffer.alloc(0);

socket.on("data", async (chunk) => {
  buf = Buffer.concat([buf, chunk]);

  while (true) {
    if (connection.state === "HANDSHAKING") {
      // Need 68 bytes
      if (buf.length < 68) break;

      const message = buf.subarray(0, 68);
      buf = buf.subarray(68);

      const { isSuccessful, remotePeerId } = verifyHandshake(
        handshakeBuf,
        message,
      );

      if (!isSuccessful) {
        // handle invalid handshake
        break;
      }

      dispatch(connection, {
        type: "HANDSHAKE_RECEIVED",
        peerId: remotePeerId,
      });

      continue;
    }

    if (connection.state === "READY") {
      // Need length prefix
      if (buf.length < 4) break;

      const messageLen = buf.readUInt32BE(0);

      // Need complete message
      if (buf.length < 4 + messageLen) break;

      if (messageLen === 0) {
        buf = buf.subarray(4);
        continue;
      }

      const message = buf.subarray(4, 4 + messageLen);

      const event = parseEventFromMessage(message);
      buf = buf.subarray(4 + messageLen);

      await peer.handleEvent(event);
      console.log(event);

      continue;
    }

    break;
  }
});
