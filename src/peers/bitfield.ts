export function availablePieces(
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
