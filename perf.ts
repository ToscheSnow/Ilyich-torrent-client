import { performance } from "perf_hooks";

// Accumulator for tracking execution times
const acc: Record<string, number> = {};

/**
 * ⚠️ Tracks event loop lag.
 * Note: .unref() is Node.js specific; ensure this runs in a Node environment.
 */
export function startLagMonitor() {
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const lag = now - last - 100; // How late this 100ms tick was
    if (lag > 20) {
      console.warn(`⚠️ Event loop lag: ${lag.toFixed(0)} ms`);
    }
    last = now;
  }, 100).unref();
}

/**
 * ✅ Accurately times synchronous blocks of code.
 */
export function timed<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    acc[label] = (acc[label] ?? 0) + (performance.now() - t0);
  }
}

/**
 * 🛠️ Fixed Asynchronous Timer
 * Measures actual total wall-clock span of the async operation.
 * WARNING: If multiple instances of the same label run concurrently,
 * total span will overlap.
 */
export async function timedAsync<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    acc[label] = (acc[label] ?? 0) + (performance.now() - t0);
  }
}

/**
 * 📊 Reports metrics every 5 seconds and flushes the buffer.
 */
export function startStageReport() {
  setInterval(() => {
    // Format values to 1 decimal place for cleaner logging
    const report = Object.fromEntries(
      Object.entries(acc).map(([k, v]) => [k, `${v.toFixed(1)}ms`]),
    );

    if (Object.keys(report).length > 0) {
      console.log("📊 Performance metrics per 5s:", report);
    }

    // Clear the accumulator
    for (const k in acc) delete acc[k];
  }, 5000).unref();
}
