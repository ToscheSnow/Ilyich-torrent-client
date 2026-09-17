import type { BencodeDict, BencodeVal } from "../types/parserTypes";
import { ASCII } from "./parserDecoder";

export class ByteEncoder {
  private textEncoder = new TextEncoder();

  encode(value: BencodeVal) {
    if (value instanceof Uint8Array) return this.encodeRawBytes(value);
    else if (typeof value === "string") return this.encodeByteString(value);
    else if (typeof value === "number") return this.encodeNum(value);
    else if (Array.isArray(value)) return this.encodeList(value);
    return this.encodeDict(value);
  }

  encodeNum(num: number = 0): Uint8Array {
    let repr = `i${num.toString()}e`;
    return new Uint8Array(this.textEncoder.encode(repr));
  }

  encodeByteString(content: string): Uint8Array {
    let repr = `${this.textEncoder.encode(content).length}:${content}`;
    return new Uint8Array(this.textEncoder.encode(repr));
  }

  encodeRawBytes(bytes: Uint8Array): Uint8Array {
    const prefix = this.textEncoder.encode(`${bytes.length}:`);

    const res = new Uint8Array(prefix.length + bytes.length);

    res.set(prefix, 0);
    res.set(bytes, prefix.length);

    return res;
  }

  encodeList(list: BencodeVal[]): Uint8Array {
    let serial: Uint8Array[] = [];
    let length = 0;

    for (const item of list) {
      const encoded = this.encode(item);
      serial.push(encoded);
      length += encoded.length;
    }

    const res = new Uint8Array(length + 2);

    res[0] = ASCII.l;

    let offset = 1;
    for (const encoded of serial) {
      res.set(encoded, offset);
      offset += encoded.length;
    }

    res[length + 1] = ASCII.e;
    return res;
  }

  encodeDict(dict: BencodeDict): Uint8Array {
    const encodedEntries: Uint8Array[] = [];

    const keys = Object.keys(dict).sort();
    let length = 0;

    for (const key of keys) {
      const encodedKey = this.encodeByteString(key);
      const encodedEntry = this.encode(dict[key]!);

      const entry = new Uint8Array(encodedKey.length + encodedEntry.length);
      entry.set(encodedKey, 0);
      entry.set(encodedEntry, encodedKey.length);

      length += entry.length;
      encodedEntries.push(entry);
    }

    const res = new Uint8Array(length + 2);

    res[0] = ASCII.d;
    let offset = 1;

    for (let encodedEntry of encodedEntries) {
      res.set(encodedEntry, offset);
      offset += encodedEntry.length;
    }
    res[length + 1] = ASCII.e;
    return res;
  }
}
