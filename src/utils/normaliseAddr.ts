// utils/addr.ts
export function normalizeAddr(addr: string | undefined): string {
  if (!addr) return "unknown";

  // Form 1: "::ffff:85.203.46.155"
  const dotted = addr.match(/^(?:0:0:0:0:0:|::)ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1]!;

  // Form 2: "0:0:0:0:0:ffff:55cb:2e9b" (hex groups)
  const hex = addr.match(
    /^(?:0:0:0:0:0:|::)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
  );
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }

  // Real IPv6 or plain IPv4: leave as is
  return addr;
}
