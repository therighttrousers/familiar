/** An unbounded async queue: push() from anywhere, consume with for await. */
export class Inbox<T> implements AsyncIterable<T> {
  #items: T[] = [];
  #waiting: ((item: T) => void) | undefined;

  push(item: T): void {
    if (this.#waiting) {
      const resolve = this.#waiting;
      this.#waiting = undefined;
      resolve(item);
    } else this.#items.push(item);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const next = this.#items.shift();
      yield next !== undefined ? next : await new Promise<T>((resolve) => (this.#waiting = resolve));
    }
  }
}
