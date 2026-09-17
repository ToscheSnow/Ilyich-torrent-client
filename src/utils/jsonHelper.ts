import { TextDecoder } from "util";
import { parseCompactPeers } from "../trackers.ts/reqTracker";

export function toJsonSafe(value: unknown, key?: string): unknown {
  const decoder = new TextDecoder();
  if (value instanceof Uint8Array) {
    if (key === "pieces") {
      if (value.length % 20 !== 0) {
        throw new Error(
          `Invalid pieces length: ${value.length} (must be divisible by 20)`,
        );
      }

      const pieces: string[] = [];

      for (let i = 0; i < value.length; i += 20) {
        pieces.push(Buffer.from(value.subarray(i, i + 20)).toString("hex"));
      }

      return pieces;
    }

    if (key === "peers") {
      return parseCompactPeers(value);
    }

    return decoder.decode(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [
        key,
        toJsonSafe(value, key),
      ]),
    );
  }

  return value;
}
