import { Peer } from "../peers/peer";
import type { PieceInfo } from "./peerTypes";

export type SchedulerDispatchCallback = (event: SchedulerEvent) => void;

export type SchedulerEvent =
  | { type: "CONNECTED"; peer: Peer }
  | { type: "UNCHOKE"; peer: Peer }
  | { type: "CHOKE"; peer: Peer }
  | { type: "HAVE"; peer: Peer }
  | { type: "BITFIELD" }
  | { type: "BLOCK_RECEIVED"; piece: PieceInfo }
  | { type: "DISCONNECT"; peer: Peer };
