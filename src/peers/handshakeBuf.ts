export function handshakeBuf(
  infoHash: Uint8Array,
  CLIENT_ID: Uint8Array,
): Buffer {
  // bittorrent handshake is fixed size 68 bytes
  const buf = Buffer.alloc(68);

  //write pstrlen which is 1 byte
  buf[0] = 0x13;

  const pstr = new TextEncoder().encode("BitTorrent protocol");

  // copy protcol "BitTorrent protcol" into the buffer
  buf.set(pstr, 1);

  //20 to 27 are reserved

  // 20 bytes for the infoHash
  buf.set(infoHash, 28);

  //20 bytes for the CLIENT_ID
  buf.set(CLIENT_ID, 48);

  return buf;
}
