export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class Semaphore {
  private readonly max: number;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    if (!Number.isFinite(max) || max <= 0) {
      throw new Error(`Invalid semaphore max: ${max}`);
    }
    this.max = max;
  }

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running += 1;
        resolve();
      });
    });
  }

  release(): void {
    if (this.running <= 0) {
      return;
    }
    this.running -= 1;

    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export class ShutdownFlag {
  private requested = false;

  request(): void {
    this.requested = true;
  }

  isRequested(): boolean {
    return this.requested;
  }
}

