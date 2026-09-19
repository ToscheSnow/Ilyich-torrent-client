export function availablePieces(
  receivedBitfield: Uint8Array,
  peerPieces: Set<number>,
): void {
  if (receivedBitfield.length % 8 !== 0)
    throw new Error("Invalid receivedBitfield length");

  const bytes = receivedBitfield.length / 8;
  let counter = 0;

  for (let byte = 0; byte < bytes; byte++) {
    const currByte = receivedBitfield[byte]!;

    for (let i = 0; i < 8; i++) {
      if ((currByte >> (7 - i)) & 1) peerPieces.add(counter);
      counter++;
    }
  }
}
