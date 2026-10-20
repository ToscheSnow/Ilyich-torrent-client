import { createHash, randomBytes } from "node:crypto";

const PIECE = 512 * 1024; // your piece size
const N = 2000;
const buf = randomBytes(PIECE);

function run(label: string, hashOnce: () => void) {
  for (let i = 0; i < 200; i++) hashOnce(); // warmup, ignore these

  const t0 = performance.now();
  for (let i = 0; i < N; i++) hashOnce();
  const ms = performance.now() - t0;

  const mb = (PIECE * N) / 1024 / 1024;
  console.log(
    `${label}: ${ms.toFixed(1)} ms total | ${(ms / N).toFixed(3)} ms/piece | ${(mb / (ms / 1000)).toFixed(0)} MB/s`,
  );
}

run("createHash", () => createHash("sha1").update(buf).digest());

// Bun's own hasher, check the Bun docs if this signature differs
run("Bun.CryptoHasher", () =>
  ,
);
