import type { BlockRequest, PeerEvent, TorrentPeer } from "../types/peerTypes";

type RequestKey = `${number}:${number}:${number}`;

function requestKey(r: BlockRequest): RequestKey {
  return `${r.piece}:${r.offset}:${r.length}`;
}

export function transitionPeer(
  peer: TorrentPeer,
  event: PeerEvent,
): TorrentPeer {
  switch (event.type) {
    case "CHOKE":
      return {
        ...peer,
        state: {
          ...peer.state,
          peerChoking: true,
        },
      };

    case "UNCHOKE":
      return {
        ...peer,
        state: {
          ...peer.state,
          peerChoking: false,
        },
      };

    case "INTERESTED":
      return {
        ...peer,
        state: {
          ...peer.state,
          peerInterested: true,
        },
      };

    case "NOT-INTERESTED":
      return {
        ...peer,
        state: {
          ...peer.state,
          peerInterested: false,
        },
      };

    case "HAVE":
      peer.pieces.add(event.pieceId);
      return peer;

    case "BITFIELD":
      // Decode event.field and update peer.pieces
      return peer;

    case "REQUEST":
      if (peer.state.amChoking) {
        throw new Error("Peer requested while choked");
      }

      // Validate request here
      return peer;

    case "CANCEL":
      // Remove matching request from upload/request tracking
      return peer;

    case "PIECE":
      if (peer.state.peerChoking) {
        throw new Error("Received piece while peer is choking us");
      }

      // Match against pending request
      // Remove it from pendingRequests
      // Process block elsewhere
      return peer;

    case "PORT":
      return peer;
  }
}
