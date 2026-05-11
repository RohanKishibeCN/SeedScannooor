import { fetchJson } from "./http.js";
import { Semaphore, sleep } from "./utils.js";
const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const getSolBalance = async (rpcUrl, address) => {
    const payload = {
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address]
    };
    try {
        const data = await fetchJson(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            timeoutMs: 30_000
        });
        if ("error" in data)
            return 0.0;
        const lamports = data.result?.value ?? 0;
        const sol = lamports / LAMPORTS_PER_SOL;
        return Math.round(sol * 1e8) / 1e8;
    }
    catch {
        return 0.0;
    }
};
export const getSplBalances = async (rpcUrl, ownerAddress, mintAddresses) => {
    const mintToSymbol = Object.fromEntries(Object.entries(mintAddresses).map(([symbol, mint]) => [mint, symbol.toUpperCase()]));
    const out = { usdt: 0.0, usdc: 0.0 };
    const payload = {
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [ownerAddress, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed" }]
    };
    try {
        const data = await fetchJson(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            timeoutMs: 30_000
        });
        if ("error" in data)
            return out;
        const accounts = Array.isArray(data.result?.value) ? data.result.value : [];
        for (const account of accounts) {
            const parsed = account?.account?.data?.parsed;
            const info = parsed?.info;
            const mint = info?.mint;
            const uiAmount = info?.tokenAmount?.uiAmount;
            if (!mint || typeof uiAmount !== "number")
                continue;
            const symbol = mintToSymbol[mint];
            if (!symbol)
                continue;
            if (symbol === "USDT")
                out.usdt = uiAmount;
            if (symbol === "USDC")
                out.usdc = uiAmount;
        }
        return out;
    }
    catch {
        return out;
    }
};
export const scanSolanaAddresses = async (rpcUrl, addresses, mintAddresses, maxConcurrent = 5, intervalMs = 100) => {
    const semaphore = new Semaphore(maxConcurrent);
    const tasks = addresses.map((address) => semaphore.withLock(async () => {
        const sol = await getSolBalance(rpcUrl, address);
        const spl = await getSplBalances(rpcUrl, address, mintAddresses);
        if (intervalMs > 0)
            await sleep(intervalMs);
        return { address, sol, usdt: spl.usdt, usdc: spl.usdc };
    }));
    const settled = await Promise.allSettled(tasks);
    return settled.map((s, i) => {
        if (s.status === "fulfilled")
            return s.value;
        return { address: addresses[i] ?? "", sol: 0.0, usdt: 0.0, usdc: 0.0 };
    });
};
