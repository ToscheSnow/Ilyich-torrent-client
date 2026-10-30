export function verifyHandshake(sent: Buffer, received: Buffer) {
  if (received.length < 68) {
    return {
      isSuccessful: false,
      remotePeerId: null,
    };
  }

  const protocolOK = received.subarray(0, 20).equals(sent.subarray(0, 20));
  const infoHashOK = received.subarray(28, 48).equals(sent.subarray(28, 48));

  const isSuccessful = protocolOK && infoHashOK;
  const remotePeerId = Buffer.from(received.subarray(48, 68));
  const supportsExtensions =
    isSuccessful && (received.readUInt8(25) & 0x10) !== 0;

  console.log(`Friendly client: ${remotePeerId.toHex()} supports extensions `);

  return {
    isSuccessful,
    remotePeerId,
    supportsExtensions,
  };
}
