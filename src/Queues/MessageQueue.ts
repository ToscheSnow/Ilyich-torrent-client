export class AsyncMessageQueue<T> {
  private items: T[] = [];
  private itemHead = 0;

  private waiters: ((item: T) => void)[] = [];

  pop(): Promise<T> {
    if (this.itemHead < this.items.length) {
      const item = this.items[this.itemHead]!;
      this.itemHead++;

      if (this.itemHead === this.items.length) {
        this.items = [];
        this.itemHead = 0;
      }

      return Promise.resolve(item);
    }

    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  push(item: T): void {
    const waiter = this.waiters.shift();

    if (waiter) {
      waiter(item);
      return;
    }

    this.items.push(item);
  }
}
