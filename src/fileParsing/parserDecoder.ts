import type { BencodeVal, BencodeDict } from "../types/parserTypes";

export enum ASCII {
  //compare ascii -> hex for raw bytes
  ZERO = 0x30,
  NINE = 0x39,
  COLON = 0x3a,
  l = 0x6c,
  e = 0x65,
  d = 0x64,
  i = 0x69,
  //hyphen minus = HP
  HP = 0x2d,
}

export class ByteParser {
  private decoder = new TextDecoder();
  private pos = 0;
  constructor(private buf: Uint8Array) {}

  //check if any remaining bytes
  private get done(): boolean {
    return this.pos >= this.buf.length;
  }

  private peek() {
    if (this.done) throw new Error("unexpected EOF");
    return this.buf[this.pos];
  }

  private next() {
    const b = this.peek();
    this.pos++;
    return b;
  }

  private take(n: number): Uint8Array {
    const bytes = this.buf.subarray(this.pos, this.pos + n);
    if (bytes.length < n) throw new Error("unexpected EOF");

    // move the pointer ahead here
    this.pos += n;

    //returns the actual bytes as a buffer
    return bytes;
  }

  //check required bytes at a location throws Error otherwise
  private expect(byte: number) {
    if (this.next() !== byte) throw new Error(`expected ${byte.toString(16)}`);
  }

  //consume if what you needed else skip
  private match(byte: number): boolean {
    if (!this.done && this.buf[this.pos] === byte) {
      this.pos++;
      return true;
    }
    return false;
  }

  private isDigit(byte: number) {
    return byte <= ASCII.NINE && byte >= ASCII.ZERO;
  }

  //integer i<base10>e
  private parseInteger() {
    let num = 0;
    let sign = 1;

    if (this.done || this.peek() !== ASCII.i)
      throw new Error("Expected integer");

    this.next();

    //handle negative sign
    if (this.match(ASCII.HP)) {
      if (this.peek() === ASCII.ZERO || !this.isDigit(this.peek()!))
        throw new Error("Invalid integer");
      sign = -1;
    }

    // handle leading 0s
    if (this.match(ASCII.ZERO)) {
      this.expect(ASCII.e);
      return 0;
    }

    //get number in base 10
    while (!this.done && this.isDigit(this.peek()!)) {
      num = num * 10 + (this.next()! - ASCII.ZERO);
    }

    // integer termination symbol e
    this.expect(ASCII.e);
    return num * sign;
  }

  //byte Strings lengthInBytes:bytes
  private parseByteString() {
    if (!this.isDigit(this.peek()!))
      throw new Error("Invalid call to byte string parser");

    let len = 0;

    //count bytes to be consumed
    while (!this.done && this.isDigit(this.peek()!)) {
      len = len * 10 + (this.next()! - ASCII.ZERO);
    }

    this.expect(ASCII.COLON);

    //consume len bytes from the buffer
    let bytes = this.take(len);

    return bytes;
  }

  private parseList(): BencodeVal[] {
    if (this.done || this.peek() !== ASCII.l)
      throw new Error("invalid call to list parser");

    this.next();

    let resList: BencodeVal[] = [];

    //parse items recursively
    while (!this.done && this.peek() !== ASCII.e) {
      let item = this.parseValue();
      resList.push(item);
    }

    this.expect(ASCII.e);
    return resList;
  }

  // dict d<pairs>e
  private parseDict() {
    //function to ensure sorted keys in actual byte order irrespective of text encoding

    function compareBytes(a: Uint8Array, b: Uint8Array): number {
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) return a[i]! - b[i]!;
      }
      return a.length - b.length;
    }

    if (this.done || this.peek() !== ASCII.d)
      throw new Error("Invalid call to dict parser");

    let lastKeyBytes: Uint8Array | null = null;

    //consume byte representing d
    this.next();

    const res: BencodeDict = {};

    while (!this.done && this.peek() !== ASCII.e) {
      //check sorted
      const keyBytes = this.parseByteString();
      if (lastKeyBytes !== null && compareBytes(lastKeyBytes, keyBytes) >= 0) {
        throw new Error("Unsorted key in dict");
      }
      const key = this.decoder.decode(keyBytes);
      lastKeyBytes = keyBytes;
      res[key] = this.parseValue();
    }
    this.expect(ASCII.e);
    return res;
  }

  //choose functions to execute recursively for nested structures

  private parseValue(): BencodeVal {
    if (this.done) throw new Error("unexpected EOF");
    const c = this.peek()!;

    if (c === ASCII.i) return this.parseInteger();
    if (c === ASCII.l) return this.parseList();
    if (c === ASCII.d) return this.parseDict();
    if (this.isDigit(c)) return this.parseByteString();

    throw new Error(`Unexpected byte: 0x${c.toString(16)} at pos ${this.pos}`);
  }

  //general parsing function for torrent files
  parse(): BencodeVal {
    const val = this.parseValue();
    if (!this.done) throw new Error(`Trailing data at pos ${this.pos}`);
    return val;
  }
}
