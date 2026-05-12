import { fetchJson } from "./http.js";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const COINGECKO_PARAMS = new URLSearchParams({
    ids: "ethereum,binancecoin,solana,tether,usd-coin",
    vs_currencies: "usd"
});
const DEFAULT_PRICES = {
    ethereum: 0.0,
    binancecoin: 0.0,
    solana: 0.0,
    tether: 1.0,
    "usd-coin": 1.0
};
let cachedPrices;
export const getPrices = async () => {
    const now = Date.now();
    if (cachedPrices && cachedPrices.expiresAt > now) {
        return cachedPrices.value;
    }
    try {
        const data = await fetchJson(`${COINGECKO_URL}?${COINGECKO_PARAMS.toString()}`, { method: "GET", timeoutMs: 10_000 });
        const result = {
            ethereum: data.ethereum?.usd ?? 0.0,
            binancecoin: data.binancecoin?.usd ?? 0.0,
            solana: data.solana?.usd ?? 0.0,
            tether: data.tether?.usd ?? 1.0,
            "usd-coin": data["usd-coin"]?.usd ?? 1.0
        };
        cachedPrices = { expiresAt: now + 300_000, value: result };
        return result;
    }
    catch {
        return { ...DEFAULT_PRICES };
    }
};
export const calculateTotalUsd = (addresses, prices) => {
    const chainPriceMap = {
        ethereum: prices.ethereum ?? 0.0,
        bsc: prices.binancecoin ?? 0.0,
        polygon: prices.ethereum ?? 0.0,
        arbitrum: prices.ethereum ?? 0.0,
        base: prices.ethereum ?? 0.0,
        solana: prices.solana ?? 0.0
    };
    const tetherPrice = prices.tether ?? 1.0;
    const usdCoinPrice = prices["usd-coin"] ?? 1.0;
    let total = 0.0;
    for (const addr of addresses) {
        const chain = addr.chain;
        const nativePrice = chainPriceMap[chain] ?? 0.0;
        const nativeBalance = chain === "solana"
            ? (addr.sol ?? addr.sol_balance ?? addr.native_balance ?? 0.0)
            : (addr.native_balance ?? 0.0);
        const usdt = addr.usdt ?? 0.0;
        const usdc = addr.usdc ?? 0.0;
        total += nativeBalance * nativePrice;
        total += usdt * tetherPrice;
        total += usdc * usdCoinPrice;
    }
    return total;
};
export const shouldKeep = (totalUsd, threshold = 10.0) => totalUsd >= threshold;
