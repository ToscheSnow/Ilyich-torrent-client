import type { BencodeDict, BencodeVal } from "../types/parserTypes";
import { ASCII } from "./parserDecoder";

export class BencodeEncoder {
  private textEncoder = new TextEncoder();

  //generic encode
  public encode(value: BencodeVal): Uint8Array {
    if (value instanceof Uint8Array) return this.encodeRawBytes(value);
    else if (typeof value === "string") return this.encodeByteString(value);
    else if (typeof value === "number") return this.encodeNum(value);
    else if (Array.isArray(value)) return this.encodeList(value);
    return this.encodeDict(value);
  }

  // encode numbers to bytes using TextEncoder
  private encodeNum(num: number): Uint8Array {
    let repr = `i${num.toString()}e`;
    //textEncoder writes bytes from a Uint8Buffer
    return new Uint8Array(this.textEncoder.encode(repr));
  }

  // encode byte strings for decoded strings
  private encodeByteString(content: string): Uint8Array {
    const bytes = this.textEncoder.encode(content);
    const prefix = this.textEncoder.encode(`${bytes.length}:`);

    const result = new Uint8Array(prefix.length + bytes.length);

    result.set(prefix);
    result.set(bytes, prefix.length);

    return result;
  }

  // encode raw bytes for info and other hashes to bytes
  private encodeRawBytes(bytes: Uint8Array): Uint8Array {
    //prefix => "length" + ":"
    const prefix = this.textEncoder.encode(`${bytes.length}:`);

    //res => content as bytes
    const res = new Uint8Array(prefix.length + bytes.length);

    //lay out in the buffer
    res.set(prefix, 0);
    res.set(bytes, prefix.length);

    return res;
  }

  //encode list bytes to bEncode
  private encodeList(list: BencodeVal[]): Uint8Array {
    let serial: Uint8Array[] = [];
    let length = 0;

    // store elements of the list by encoding recursively
    for (const item of list) {
      const encoded = this.encode(item);
      serial.push(encoded);
      length += encoded.length;
    }

    //extra 2 bytes for l and e
    const res = new Uint8Array(length + 2);

    res[0] = ASCII.l;

    //lay out encoded entries in a contiguous allocated location
    let offset = 1;
    for (const encoded of serial) {
      res.set(encoded, offset);
      offset += encoded.length;
    }

    res[length + 1] = ASCII.e;
    return res;
  }

  // encode dict bytes to bEncode
  private encodeDict(dict: BencodeDict): Uint8Array {
    const encodedEntries: Uint8Array[] = [];

    //loop over sorted object to ensure valid sorted byteStrings
    const keys = Object.keys(dict).sort();
    let length = 0;

    //encode entries of the dictionary recursively
    for (const key of keys) {
      const encodedKey = this.encodeByteString(key);
      const encodedEntry = this.encode(dict[key]!);

      const entry = new Uint8Array(encodedKey.length + encodedEntry.length);
      entry.set(encodedKey, 0);
      entry.set(encodedEntry, encodedKey.length);

      length += entry.length;
      encodedEntries.push(entry);
    }

    // extra two space for letters d and e
    const res = new Uint8Array(length + 2);

    res[0] = ASCII.d;
    let offset = 1;

    //offset helps lay the arrays in a contiguous order
    for (const encodedEntry of encodedEntries) {
      res.set(encodedEntry, offset);
      offset += encodedEntry.length;
    }

    res[length + 1] = ASCII.e;
    return res;
  }
}
