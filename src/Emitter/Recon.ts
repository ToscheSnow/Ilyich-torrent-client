export class Recon<E extends Record<string, unknown[]>> {
  private listeners = new Map<keyof E, Array<(...args: any[]) => void>>();

  public listen<K extends keyof E>(
    event: K,
    fn: (...args: E[K]) => void,
  ): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);

    this.listeners.set(event, list);

    return () => {
      this.unsubscribe(event, fn);
    };
  }

  public announce<K extends keyof E>(event: K, ...args: E[K]) {
    const list = [...(this.listeners.get(event) ?? [])];

    for (const fn of list) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`listener for "${String(event)}" threw`, err);
      }
    }
  }

  unsubscribe<K extends keyof E>(event: K, fn: (...args: E[K]) => void): void {
    const list = this.listeners.get(event);
    if (!list) return;

    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
  }

  once<K extends keyof E>(event: K, fn: (...args: E[K]) => void): () => void {
    const off = this.listen(event, (...args) => {
      off();
      fn(...args);
    });

    return off;
  }

  public listenerCount<K extends keyof E>(event: K) {
    return this.listeners.get(event)?.length ?? 0;
  }
}
