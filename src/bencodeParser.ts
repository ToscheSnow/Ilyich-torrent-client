enum ASCII {
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

type BencodeVal = number | string | BencodeVal[] | BencodeDict | Uint8Array;
type BencodeDict = {
  [key: string]: BencodeVal;
};

export class BitParser {
  private decoder = new TextDecoder();
  private pos = 0;
  constructor(private buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  peek() {
    if (this.done) throw new Error("unexpected EOF");
    return this.buf[this.pos];
  }

  next() {
    const b = this.peek();
    this.pos++;
    return b;
  }

  take(n: number) {
    const bytes = this.buf.subarray(this.pos, this.pos + n);
    if (bytes.length < n) throw new Error("unexpected EOF");
    this.pos += n;
    return bytes;
  }

  expect(byte: number) {
    if (this.next() !== byte) throw new Error(`expected ${byte.toString(16)}`);
  }

  match(byte: number): boolean {
    if (!this.done && this.buf[this.pos] === byte) {
      this.pos++;
      return true;
    }
    return false;
  }

  isDigit(byte: number) {
    return byte <= ASCII.NINE && byte >= ASCII.ZERO;
  }

  parseInteger() {
    let num = 0;
    let sign = 1;

    if (this.done || this.peek() !== ASCII.i)
      throw new Error("Expected integer");

    this.next();

    if (this.match(ASCII.HP)) {
      if (this.peek() === ASCII.ZERO || !this.isDigit(this.peek()!))
        throw new Error("Invalid integer");
      sign = -1;
    }

    if (this.match(ASCII.ZERO)) {
      this.expect(ASCII.e);
      return 0;
    }

    while (!this.done && this.isDigit(this.peek()!)) {
      num = num * 10 + (this.next()! - ASCII.ZERO);
    }

    this.expect(ASCII.e);
    return num * sign;
  }

  parseByteString() {
    if (!this.isDigit(this.peek()!))
      throw new Error("Invalid call to byte string parser");

    let len = 0;

    while (!this.done && this.isDigit(this.peek()!)) {
      len = len * 10 + (this.next()! - ASCII.ZERO);
    }

    this.expect(ASCII.COLON);

    let bytes = this.take(len);

    return bytes;
  }

  parseList(): BencodeVal[] {
    if (this.done || this.peek() !== ASCII.l)
      throw new Error("invalid call to list parser");

    this.next();

    let resList: BencodeVal[] = [];

    while (!this.done && this.peek() !== ASCII.e) {
      const next = this.peek()!;
      let item = this.parseValue();
      resList.push(item);
    }
    this.expect(ASCII.e);
    return resList;
  }

  parseDict() {
    function compareBytes(a: Uint8Array, b: Uint8Array): number {
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) return a[i]! - b[i]!;
      }
      return a.length - b.length;
    }

    let lastKeyBytes: Uint8Array | null = null;
    if (this.done || this.peek() !== ASCII.d)
      throw new Error("Invalid call to dict parser");

    this.next();

    const res: BencodeDict = {};

    while (!this.done && this.peek() !== ASCII.e) {
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

  parseValue(): BencodeVal {
    if (this.done) throw new Error("unexpected EOF");
    const c = this.peek()!;

    if (c === ASCII.i) return this.parseInteger();
    if (c === ASCII.l) return this.parseList();
    if (c === ASCII.d) return this.parseDict();
    if (this.isDigit(c)) return this.parseByteString();

    throw new Error(`Unexpected byte: 0x${c.toString(16)} at pos ${this.pos}`);
  }

  parse(): BencodeVal {
    const val = this.parseValue();
    if (!this.done) throw new Error(`Trailing data at pos ${this.pos}`);
    return val;
  }
}
