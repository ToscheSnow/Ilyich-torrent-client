import { Torrent } from "./src/torrent";
import { openFile } from "./src/utils/input";

// file path is args[0]
const args = process.argv.slice(2);
const filePath = args[0] ?? "./debi.torrent";
const downloadPath = args[1] ?? "./download";
const listenPort = Number(args[2] ?? 6881);

const torrent = new Torrent(openFile(filePath), downloadPath);
torrent.start(listenPort);
