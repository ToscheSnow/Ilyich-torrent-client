import { createHash } from "node:crypto";

export function validDecode(original: Uint8Array, encoded: Uint8Array) {
  const originalHash = createHash("sha1").update(original).digest();
  const encodedHash = createHash("sha1").update(encoded).digest();

  return originalHash.equals(encodedHash);
}
