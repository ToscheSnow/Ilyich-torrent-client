import net from "node:net";
import { handshake } from "./handshake";
import { getHash } from "../trackers/info_hash";
import { readFileSync } from "node:fs";
import type { PeerLocation } from "../types/tracker";
import { CLIENT_ID_BYTES } from "../../client";

const peer: PeerLocation = {
  ip: "127.0.0.1",
  port: 6881,
};

const socket = net.createConnection(peer);

const hash = getHash(readFileSync("./2001.torrent"));

socket.on("connect", () => {
  console.log("Connected");
  if (socket.write(handshake(hash, CLIENT_ID_BYTES))) {
  }
});

socket.on("data", (data) => console.log(data));
