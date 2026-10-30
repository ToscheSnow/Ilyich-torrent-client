import { z } from "zod";

const magnetSchema = z.object({
  xt: z
    .array(z.string())
    .transform((v): Uint8Array => Uint8Array.fromHex(v.join(""))),
  dn: z
    .array(z.string())
    .length(1, "name must appear only once")
    .transform(([v]) => parsePercentEncoded(v!))
    .optional(),
  tr: z
    .array(z.string().transform((url) => parsePercentEncoded(url)))
    .min(1, "This magnet has no trackers, we dont support DHT"),
  xl: z.coerce.number().optional(),
  so: z.array(z.array(z.coerce.number())).optional(),
});

type Magnet = z.infer<typeof magnetSchema>;

const testLinks = [
  "magnet:?xt=urn:btih:26f1ce29e36b0b4b72a1b0974776af082f97fcb0&dn=Spider-Man.Brand.New.Day.2026.1080p.WEBRip.10Bit.DDP5.1.x265-NeoNoir.mkv&xl=3188249909&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.demonii.com:1337/announce&tr=http://open.tracker.cl:1337/announce&tr=udp://open.stealth.si:80/announce&tr=udp://tracker.torrent.eu.org:451/announce&tr=udp://explodie.org:6969/announce&tr=udp://exodus.desync.com:6969/announce&tr=udp://tracker.ololosh.space:6969/announce&tr=udp://tracker.dump.cl:6969/announce&tr=udp://tracker.bittor.pw:1337/announce&tr=udp://tracker-udp.gbitt.info:80/announce&tr=udp://retracker01-msk-virt.corbina.net:80/announce&tr=udp://open.free-tracker.ga:6969/announce&tr=udp://ns-1.x-fins.com:6969/announce&tr=udp://leet-tracker.moe:1337/announce",
  "magnet:?xt=urn:btih:26f1ce29e36b0b4b72a1b0974776af082f97fcb0",
];

function parseMagnetLink(link: string): Magnet {
  if (!link.startsWith("magnet:?"))
    throw new Error("No magnet protocol identifier found ❌");

  const chunks = link.slice("magnet:?".length).split("&");
  const fields = new Map<string, string[]>();
  for (const chunk of chunks) {
    const [field, val] = chunk.split("=");
    if (!field || !val || !(field in magnetSchema.shape)) continue;
    const params = fields.get(field) ?? [];
    params.push(val);
    fields.set(field, params);
  }

  const param = fields.get("xt")?.join("");

  if (param) {
    const infoHashHexString = param.replace("urn:btih:", "").split("");
    fields.set("xt", infoHashHexString);
  }

  const res: Record<string, string[]> = Object.fromEntries(fields);
  const parsedMagnet = magnetSchema.safeParse(res);

  if (parsedMagnet.success) return parsedMagnet.data;
  throw new Error(JSON.stringify(parsedMagnet.error.flatten(), null, 2));
}

for (const link of testLinks) {
  try {
    const parsedMagnet = parseMagnetLink(link);
    console.log(parsedMagnet);
  } catch (er) {
    if (er instanceof Error) console.log(`${er.message}`);
  }
}

function parsePercentEncoded(link: string): string {
  const rawBytes = new TextEncoder().encode(link);
  const formattedBytes = [];

  const PERCENT_SIGN = 0x25;
  for (let i = 0; i < rawBytes.length; i++) {
    const nextTwo = String.fromCharCode(
      rawBytes[i + 1] ?? 0,
      rawBytes[i + 2] ?? 0,
    );

    if (rawBytes[i] === PERCENT_SIGN && /^[0-9a-f]{2}$/i.test(nextTwo)) {
      formattedBytes.push(parseInt(nextTwo, 16));
      i += 2;
    } else formattedBytes.push(rawBytes[i]);
  }
  return new TextDecoder().decode(Uint8Array.from(formattedBytes));
}
