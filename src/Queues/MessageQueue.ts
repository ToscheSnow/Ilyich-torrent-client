export class AsyncMessageQueue<T> {
  private items: T[] = [];
  private itemHead = 0;

  private waiterHead = 0;
  private waiters: ((item: T) => void)[] = [];

  pop(): Promise<T> {
    if (this.items.length - this.itemHead > 0) {
      const item = this.items[this.itemHead++]!;

      return Promise.resolve(item);
    }

    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  push(item: T): void {
    const waiter = this.waiters[this.waiterHead];

    if (waiter) {
      this.waiterHead++;
      waiter(item);
      return;
    }

    this.items.push(item);
  }
}
