import { heapStats } from "bun:jsc";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function printMemory(label = "Memory") {
  const memory = process.memoryUsage();
  const heap = heapStats();

  console.log(`\n========== ${label} ==========`);

  console.log(`RSS:          ${mb(memory.rss)}`);
  console.log(`Heap used:    ${mb(memory.heapUsed)}`);
  console.log(`Heap total:   ${mb(memory.heapTotal)}`);
  console.log(`External:     ${mb(memory.external)}`);
  console.log(`Buffers:      ${mb(memory.arrayBuffers)}`);

  console.log(`JSC heap:     ${mb(heap.heapSize)}`);
  console.log(`JSC capacity: ${mb(heap.heapCapacity)}`);
  console.log(`Extra memory: ${mb(heap.extraMemorySize)}`);
  console.log(`Objects:      ${heap.objectCount}`);

  console.log("==============================\n");
}
