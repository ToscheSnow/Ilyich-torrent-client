import type { PeerEvent } from "../types/peerTypes";

enum PEER_MESSAGE_ID {
  CHOKE,
  UNCHOKE,
  INTERESTED,
  NOT_INTERESTED,
  HAVE,
  BITFIELD,
  REQUEST,
  PIECE,
  CANCEL,
  PORT,
  EXTENDED = 20,
}

export function decodeIncomingPeerMessage(message: Buffer): PeerEvent {
  // messageID always takes up 1 byte
  const messageID = message.readUInt8();
  //according to the bitTorrent protocol

  //must read unsigned integers
  switch (messageID) {
    case PEER_MESSAGE_ID.CHOKE:
      return { type: "CHOKE" };

    case PEER_MESSAGE_ID.UNCHOKE:
      return { type: "UNCHOKE" };

    case PEER_MESSAGE_ID.INTERESTED:
      return { type: "INTERESTED" };

    case PEER_MESSAGE_ID.NOT_INTERESTED:
      return { type: "NOT_INTERESTED" };

    case PEER_MESSAGE_ID.HAVE:
      // HAVE request has a payload of 4 bytes
      if (message.length !== 5) throw new Error("Invalid HAVE message");
      return { type: "HAVE", pieceId: message.readUInt32BE(1) };

    case PEER_MESSAGE_ID.BITFIELD:
      return { type: "BITFIELD", field: Buffer.from(message.subarray(1)) };

    case PEER_MESSAGE_ID.REQUEST:
      
      //REQUEST has a payload of 12 bytes from 4 each from pieceNum , offset and length
      if (message.length !== 13) throw new Error("Invalid REQUEST message");
      return {
        type: "REQUEST",
        block: {
          pieceIdx: message.readUInt32BE(1),
          offset: message.readUInt32BE(5),
          length: message.readUInt32BE(9),
        },
      };

    case PEER_MESSAGE_ID.PIECE:
      //piece and offset consume atleast 8 bytes 4 from each
      if (message.length < 9)
        throw new Error("Piece isn't of sufficient length");
      return {
        type: "PIECE",
        piece: {
          pieceIdx: message.readUInt32BE(1),
          offset: message.readUInt32BE(5),
          block: Buffer.from(message.subarray(9)),
        },
      };

    case PEER_MESSAGE_ID.CANCEL:
      // CANCEL request payload has exactly 12 bytes 4 from each piece,offset and length
      if (message.length !== 13) throw new Error("Invalid CANCEL message");
      return {
        type: "CANCEL",
        block: {
          // same fix as REQUEST above
          pieceIdx: message.readUInt32BE(1),
          offset: message.readUInt32BE(5),
          length: message.readUInt32BE(9),
        },
      };

    //no idea what port does 🥺
    case PEER_MESSAGE_ID.PORT:
      if (message.length !== 3) {
        throw new Error("Invalid PORT message");
      }

      return {
        type: "PORT",
      };

    case PEER_MESSAGE_ID.EXTENDED:
      return {
        type: "EXTENDED",
      };

    default:
      throw new Error("invalid call to peerMessageParser");
  }
}
