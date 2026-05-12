export class HttpError extends Error {
    status;
    bodyText;
    constructor(status, bodyText) {
        super(`HTTP ${status}: ${bodyText}`);
        this.status = status;
        this.bodyText = bodyText;
    }
}
export const fetchJson = async (url, options = {}) => {
    const { timeoutMs, ...init } = options;
    const controller = new AbortController();
    const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
        const resp = await fetch(url, { ...init, signal: controller.signal });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new HttpError(resp.status, text);
        }
        return (await resp.json());
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
};
