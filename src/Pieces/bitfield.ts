export function addPiece(bitfield: Uint8Array, idx: number): void {
  if (idx >> 3 >= bitfield.length)
    throw new Error("pieceIndex outside of valid bounds");
  bitfield[idx >> 3]! |= 1 << (7 - (idx % 8));
}

export function hasPiece(bitfield: Uint8Array, idx: number): boolean {
  if (idx >> 3 >= bitfield.length)
    throw new Error("pieceIndex outside of valid bounds");

  return (bitfield[idx >> 3]! & (1 << (7 - (idx % 8)))) !== 0;
}

export function countPieces(bitfield: Uint8Array): number {
  let count = 0;

  for (let i = 0; i < bitfield.length; i++) {
    let byte = bitfield[i]!;

    // Check all 8 bits inside this single byte
    for (let bit = 0; bit < 8; bit++) {
      // If the rightmost bit is 1, increment count
      if ((byte & 1) === 1) {
        count++;
      }
      // Move to the next bit
      byte >>= 1;
    }
  }

  return count;
}
