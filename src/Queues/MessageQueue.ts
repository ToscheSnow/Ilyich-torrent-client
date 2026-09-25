import { Queue } from "@datastructures-js/queue";

export class AsyncMessageQueue<T> {
  private items: Queue<T> = new Queue<T>();
  private closed = false;
  private consumers: Queue<(item: T | undefined) => void> = new Queue();

  pop(): Promise<T | undefined> {
    if (!this.items.isEmpty()) {
      return Promise.resolve(this.items.pop()!);
    }
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      this.consumers.push(resolve);
    });
  }

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.consumers.pop();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (!this.consumers.isEmpty()) {
      const resolve = this.consumers.pop()!;
      resolve(undefined);
    }
  }
}
