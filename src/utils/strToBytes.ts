export function strToBytes(message: string): Uint8Array {
  return new TextEncoder().encode(message);
}
