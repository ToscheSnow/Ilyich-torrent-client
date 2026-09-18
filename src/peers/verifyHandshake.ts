export function verifyHandshake(sent: Buffer, received: Buffer) {
  const isSuccessful = sent.subarray(0, 48).equals(received.subarray(0, 48));
  const remotePeerId = Buffer.from(received.subarray(48, 68));

  return { isSuccessful, remotePeerId };
}
