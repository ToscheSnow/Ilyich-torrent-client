import { Queue } from "@datastructures-js/queue";

export class AsyncMessageQueue<T> {
  private items: Queue<T> = new Queue<T>();

  private consumers: Queue<(item: T) => void> = new Queue<(item: T) => void>();

  pop(): Promise<T> {
    if (!this.items.isEmpty()) {
      const item = this.items.pop()!;

      return Promise.resolve(item);
    }

    return new Promise<T>((resolve) => {
      this.consumers.push(resolve);
    });
  }

  push(item: T): void {
    const waiter = this.consumers.pop();

    if (waiter) {
      waiter(item);
      return;
    }

    this.items.push(item);
  }
}
