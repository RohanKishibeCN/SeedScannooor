import type { EvmAddressBalance } from "./types.js";
import { fetchJson } from "./http.js";
import { Semaphore, sleep } from "./utils.js";
import { HttpError } from "./http.js";

const TATUM_BASE_URL = "https://api.tatum.io/v4/data/wallet/portfolio";

let tatumErrorLogCount = 0;

export const getChainTatumId = (chain: string): string => {
  const chainMapping: Record<string, string> = {
    ethereum: "ethereum",
    eth: "ethereum",
    bsc: "bsc",
    polygon: "polygon",
    matic: "polygon",
    arbitrum: "arbitrum-one",
    arb: "arbitrum-one",
    "arbitrum-one": "arbitrum-one",
    base: "base"
  };
  return chainMapping[chain.toLowerCase()] ?? "ethereum";
};

interface TatumToken {
  symbol?: string;
  decimals?: number | string;
  balance?: string;
}

interface TatumPortfolioResponse {
  balance?: string;
  tokens?: TatumToken[];
}

export const getAddressBalances = async (
  apiKey: string,
  address: string,
  chain: string
): Promise<EvmAddressBalance> => {
  const chainId = getChainTatumId(chain);

  const result: EvmAddressBalance = {
    address,
    native_balance: 0.0,
    usdt: 0.0,
    usdc: 0.0,
    raw_tokens: []
  };

  const fetchPortfolio = async (tokenTypes: "native" | "fungible"): Promise<TatumPortfolioResponse> => {
    const url = new URL(TATUM_BASE_URL);
    url.searchParams.set("chain", chainId);
    url.searchParams.set("addresses", address);
    url.searchParams.set("tokenTypes", tokenTypes);

    return await fetchJson<TatumPortfolioResponse>(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        accept: "application/json"
      },
      timeoutMs: 30_000
    });
  };

  const logHttpError = (e: unknown): void => {
    if (!(e instanceof HttpError)) return;
    const importantStatuses = new Set([400, 401, 403, 429]);
    if (!importantStatuses.has(e.status)) return;
    if (tatumErrorLogCount >= 5) return;

    tatumErrorLogCount += 1;
    console.error(`Tatum request failed: status=${e.status} chain=${chainId} address=${address}`);
    if (tatumErrorLogCount === 5) {
      console.error("Tatum request failed: too many errors, suppressing further logs...");
    }
  };

  try {
    const nativeData = await fetchPortfolio("native");
    if (nativeData.balance) {
      const wei = Number.parseInt(nativeData.balance, 10);
      if (Number.isFinite(wei)) {
        result.native_balance = Math.round((wei / 10 ** 18) * 1e8) / 1e8;
      }
    }
  } catch (e) {
    logHttpError(e);
  }

  try {
    const tokenData = await fetchPortfolio("fungible");
    if (Array.isArray(tokenData.tokens)) {
      result.raw_tokens = tokenData.tokens;

      for (const token of tokenData.tokens) {
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
        if (symbol === "USDT") result.usdt = Math.round(balance * 1e8) / 1e8;
        if (symbol === "USDC") result.usdc = Math.round(balance * 1e8) / 1e8;
      }
    }
  } catch (e) {
    logHttpError(e);
  }

  return result;
};

export const scanEvmAddresses = async (
  apiKey: string,
  addresses: string[],
  chain: string,
  maxConcurrent = 5,
  intervalMs = 100
): Promise<EvmAddressBalance[]> => {
  const semaphore = new Semaphore(maxConcurrent);

  const tasks = addresses.map((address) =>
    semaphore.withLock(async () => {
      const res = await getAddressBalances(apiKey, address, chain);
      if (intervalMs > 0) await sleep(intervalMs);
      return res;
    })
  );

  const settled = await Promise.allSettled(tasks);
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    return {
      address: addresses[i] ?? "",
      native_balance: 0.0,
      usdt: 0.0,
      usdc: 0.0,
      raw_tokens: []
    };
  });
};
