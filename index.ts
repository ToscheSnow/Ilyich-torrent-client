import { Torrent } from "./torrent";

const torrent = new Torrent(
  "./debi.torrent",
  "/Users/dhruv/Code/bunnyHunt/download",
);

torrent.start();
