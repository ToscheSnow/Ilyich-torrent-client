import type { PeerEvent } from "../types/peerTypes";

export function parseEventFromMessage(message: Buffer): PeerEvent {
  // messageID always takes up 1 byte
  const messageID = message.readUInt8();
  //according to the bitTorrent protocol

  //must read unsigned integers
  switch (messageID) {
    case 0:
      return { type: "CHOKE" };
    case 1:
      return { type: "UNCHOKE" };
    case 2:
      return { type: "INTERESTED" };
    case 3:
      return { type: "NOT-INTERESTED" };
    case 4:
      // HAVE request has a payload of 4 bytes
      if (message.length !== 5) throw new Error("Invalid HAVE message");
      return { type: "HAVE", pieceId: message.readUInt32BE(1) };
    case 5:
      return { type: "BITFIELD", field: Buffer.from(message.subarray(1)) };
    case 6:
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
    case 7:
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
    case 8:
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
    case 9:
      return {
        type: "PORT",
        //dont know what port even does 😂
      };

    default:
      throw new Error("invalid call to peerMessageParser");
  }
}
