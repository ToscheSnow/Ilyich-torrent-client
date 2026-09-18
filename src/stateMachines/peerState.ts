export interface PeerState {
  // i can send
  amChoking: boolean;

  // i want something
  amInterested: boolean;

  // i can not receive
  peerChoking: boolean;

  // they want something
  peerInterested: boolean;
}

export interface TorrentPeer {
  state: PeerState;
  pieces: Set<number>;
  pending: Set<number>;
  queue: number[];
}

export type PeerEvent =
  | { type: "CHOKE" }
  | { type: "UNCHOKE" }
  | { type: "INTERESTED" }
  | { type: "NOT-INTERESTED" }
  | { type: "HAVE"; pieceId: number }
  | { type: "BITFIELD"; field: Uint8Array }
  | { type: "REQUEST"; piece: number; index: number; length: number }
  | { type: "PIECE"; piece: number; offset: number; block: Buffer }
  | { type: "CANCEL"; piece: number; index: number; length: number }
  | { type: "PORT" };

function transitionPEER(state: PeerState, event: PeerEvent) {
  switch (event.type) {
    case "CHOKE": {
      state.peerChoking = true;
      return state;
    }
    case "UNCHOKE": {
      state.peerChoking = false;
      return state;
    }
    case "INTERESTED": {
      state.peerInterested = true;
      return state;
    }
    case "NOT-INTERESTED": {
      state.peerInterested = false;
      return state;
    }
    case "HAVE": {
      return state;
    }
    case "BITFIELD": {
      return state;
    }

    case "REQUEST": {
      if (state.amChoking) {
        throw new Error("Peer requested while choked");
      }

      return state;
    }
    case "CANCEL": {
      return state;
    }

    case "PIECE": {
      if (state.peerChoking) {
        throw new Error("Received piece while peer is choking us");
      }

      return state;
    }

    default:
      throw new Error("Invalid event to state handler");
  }
}

export function dispatchPeer(peer: TorrentPeer, event: PeerEvent) {
  peer.state = transitionPEER(peer.state, event);
}
