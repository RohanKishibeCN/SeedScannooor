export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class Semaphore {
    max;
    running = 0;
    queue = [];
    constructor(max) {
        if (!Number.isFinite(max) || max <= 0) {
            throw new Error(`Invalid semaphore max: ${max}`);
        }
        this.max = max;
    }
    async acquire() {
        if (this.running < this.max) {
            this.running += 1;
            return;
        }
        await new Promise((resolve) => {
            this.queue.push(() => {
                this.running += 1;
                resolve();
            });
        });
    }
    release() {
        if (this.running <= 0) {
            return;
        }
        this.running -= 1;
        const next = this.queue.shift();
        if (next) {
            next();
        }
    }
    async withLock(fn) {
        await this.acquire();
        try {
            return await fn();
        }
        finally {
            this.release();
        }
    }
}
export class ShutdownFlag {
    requested = false;
    request() {
        this.requested = true;
    }
    isRequested() {
        return this.requested;
    }
}
