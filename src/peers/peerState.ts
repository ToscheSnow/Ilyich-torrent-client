export interface PeerState {
  amChoking: boolean;
  amInterested: boolean;

  peerChoking: boolean;
  peerInterested: boolean;
}

export type PeerEvent= "CHOKE" | "UNCHOKE" | "INTERESTED" | "UNINTERESTED" | 

// function transition(state: PeerState, event: PeerEvent) {}
