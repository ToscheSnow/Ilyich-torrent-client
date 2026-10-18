// perf.ts
export function startLagMonitor() {
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const lag = now - last - 100; // how late this tick was
    if (lag > 20) console.log(`⚠️ event loop lag: ${lag.toFixed(0)} ms`);
    last = now;
  }, 100).unref();
}

const acc: Record<string, number> = {};

export function timed<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    acc[label] = (acc[label] ?? 0) + performance.now() - t0;
  }
}

// for anything with await inside
export async function timedAsync<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    acc[label] = (acc[label] ?? 0) + performance.now() - t0;
  }
}

export function startStageReport() {
  setInterval(() => {
    console.log("📊 ms per 5s:", { ...acc });
    for (const k in acc) acc[k] = 0;
  }, 5000).unref();
}
