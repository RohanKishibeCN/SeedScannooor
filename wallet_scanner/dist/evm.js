import { fetchJson } from "./http.js";
import { Semaphore, sleep } from "./utils.js";
const TATUM_BASE_URL = "https://api.tatum.io/v4/data/wallet/portfolio";
export const getChainTatumId = (chain) => {
    const chainMapping = {
        ethereum: "eth",
        eth: "eth",
        bsc: "bsc",
        polygon: "polygon",
        matic: "polygon",
        arbitrum: "arb",
        arb: "arb",
        base: "base"
    };
    return chainMapping[chain.toLowerCase()] ?? "eth";
};
export const getAddressBalances = async (apiKey, address, chain) => {
    const chainId = getChainTatumId(chain);
    const result = {
        address,
        native_balance: 0.0,
        usdt: 0.0,
        usdc: 0.0,
        raw_tokens: []
    };
    try {
        const url = new URL(TATUM_BASE_URL);
        url.searchParams.set("address", address);
        url.searchParams.set("chain", chainId);
        const data = await fetchJson(url.toString(), {
            method: "GET",
            headers: {
                "x-api-key": apiKey,
                accept: "application/json"
            },
            timeoutMs: 30_000
        });
        if (data.balance) {
            const wei = Number.parseInt(data.balance, 10);
            if (Number.isFinite(wei)) {
                result.native_balance = Math.round((wei / 10 ** 18) * 1e8) / 1e8;
            }
        }
        if (Array.isArray(data.tokens)) {
            result.raw_tokens = data.tokens;
            for (const token of data.tokens) {
                const symbol = (token.symbol ?? "").toUpperCase();
                if (symbol !== "USDT" && symbol !== "USDC") {
                    continue;
                }
                const decimals = Number.parseInt(String(token.decimals ?? "6"), 10);
                const rawBalance = Number.parseInt(String(token.balance ?? "0"), 10);
                if (!Number.isFinite(decimals) || !Number.isFinite(rawBalance)) {
                    continue;
                }
                const balance = rawBalance / 10 ** decimals;
                if (symbol === "USDT")
                    result.usdt = Math.round(balance * 1e8) / 1e8;
                if (symbol === "USDC")
                    result.usdc = Math.round(balance * 1e8) / 1e8;
            }
        }
    }
    catch {
        return result;
    }
    return result;
};
export const scanEvmAddresses = async (apiKey, addresses, chain, maxConcurrent = 5, intervalMs = 100) => {
    const semaphore = new Semaphore(maxConcurrent);
    const tasks = addresses.map((address) => semaphore.withLock(async () => {
        const res = await getAddressBalances(apiKey, address, chain);
        if (intervalMs > 0)
            await sleep(intervalMs);
        return res;
    }));
    const settled = await Promise.allSettled(tasks);
    return settled.map((s, i) => {
        if (s.status === "fulfilled")
            return s.value;
        return {
            address: addresses[i] ?? "",
            native_balance: 0.0,
            usdt: 0.0,
            usdc: 0.0,
            raw_tokens: []
        };
    });
};
