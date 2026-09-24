export function addPiecesFromBitfield(
  receivedBitfield: Uint8Array,
  peerPieces: Set<number>,
): void {
  let counter = 0;

  for (let byte = 0; byte < receivedBitfield.length; byte++) {
    const currByte = receivedBitfield[byte]!;

    for (let i = 0; i < 8; i++) {
      if ((currByte >> (7 - i)) & 1) peerPieces.add(counter);
      counter++;
    }
  }
}

export function BITFIELD_BUF(
  verifiedPieces: ReadonlySet<number>,
  pieceCount: number,
): Buffer {
  const bitfield = Buffer.alloc(Math.ceil(pieceCount / 8));

  for (const pieceIdx of verifiedPieces) {
    const byteIdx = Math.floor(pieceIdx / 8);
    const bitIdx = pieceIdx % 8;

    bitfield[byteIdx] = (bitfield[byteIdx] ?? 0) | (1 << (7 - bitIdx));
  }

  return bitfield;
}
