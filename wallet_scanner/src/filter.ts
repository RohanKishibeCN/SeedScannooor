import type { AddressBalanceWithChain, Prices } from "./types.js";
import { fetchJson } from "./http.js";

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const COINGECKO_PARAMS = new URLSearchParams({
  ids: "ethereum,binancecoin,solana,tether,usd-coin",
  vs_currencies: "usd"
});

const DEFAULT_PRICES: Prices = {
  ethereum: 0.0,
  binancecoin: 0.0,
  solana: 0.0,
  tether: 1.0,
  "usd-coin": 1.0
};

let cachedPrices: { expiresAt: number; value: Prices } | undefined;

export const getPrices = async (): Promise<Prices> => {
  const now = Date.now();
  if (cachedPrices && cachedPrices.expiresAt > now) {
    return cachedPrices.value;
  }

  try {
    const data = await fetchJson<Record<string, { usd?: number }>>(
      `${COINGECKO_URL}?${COINGECKO_PARAMS.toString()}`,
      { method: "GET", timeoutMs: 10_000 }
    );

    const result: Prices = {
      ethereum: data.ethereum?.usd ?? 0.0,
      binancecoin: data.binancecoin?.usd ?? 0.0,
      solana: data.solana?.usd ?? 0.0,
      tether: data.tether?.usd ?? 1.0,
      "usd-coin": data["usd-coin"]?.usd ?? 1.0
    };

    cachedPrices = { expiresAt: now + 300_000, value: result };
    return result;
  } catch {
    return { ...DEFAULT_PRICES };
  }
};

export const calculateTotalUsd = (addresses: AddressBalanceWithChain[], prices: Prices): number => {
  const chainPriceMap: Record<string, number> = {
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

    const nativeBalance =
      chain === "solana"
        ? ((addr as any).sol ?? (addr as any).sol_balance ?? (addr as any).native_balance ?? 0.0)
        : ((addr as any).native_balance ?? 0.0);

    const usdt = (addr as any).usdt ?? 0.0;
    const usdc = (addr as any).usdc ?? 0.0;

    total += nativeBalance * nativePrice;
    total += usdt * tetherPrice;
    total += usdc * usdCoinPrice;
  }

  return total;
};

export const shouldKeep = (totalUsd: number, threshold = 10.0): boolean => totalUsd >= threshold;

