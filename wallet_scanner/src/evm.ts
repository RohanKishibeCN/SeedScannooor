import { fetchJson } from "./http.js";
import { sleep } from "./utils.js";
import type { EvmAddressBalance, TokenConfig } from "./types.js";

const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

interface BalanceMultiItem {
  account: string;
  balance: string;
}

const knownTokenDecimals: Record<string, number> = {
  "0xdAC17F958D2ee523a2206206994597C13D831ec7": 6,
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 6,
};

const getTokenDecimals = (contract: string): number => {
  const key = contract.toLowerCase();
  return knownTokenDecimals[key] ?? 18;
};

const queryEthBalances = async (
  apiKey: string,
  addresses: string[]
): Promise<Map<string, number>> => {
  const resultMap = new Map<string, number>();

  try {
    const url = `${ETHERSCAN_BASE}?chainid=1&module=account&action=balancemulti&address=${addresses.join(",")}&tag=latest&apikey=${apiKey}`;
    const data = await fetchJson<EtherscanResponse<BalanceMultiItem[]>>(url, {
      method: "GET",
      timeoutMs: 15_000,
    });

    if (data.status !== "1" || !Array.isArray(data.result)) {
      return resultMap;
    }

    for (const item of data.result) {
      const addr = item.account.toLowerCase();
      const wei = BigInt(item.balance);
      resultMap.set(addr, Number(wei) / 1e18);
    }
  } catch {
    // silently return empty map on error
  }

  return resultMap;
};

const queryTokenBalance = async (
  apiKey: string,
  address: string,
  contract: string
): Promise<number> => {
  try {
    const url = `${ETHERSCAN_BASE}?chainid=1&module=account&action=tokenbalance&contractaddress=${contract}&address=${address}&tag=latest&apikey=${apiKey}`;
    const data = await fetchJson<EtherscanResponse<string>>(url, {
      method: "GET",
      timeoutMs: 15_000,
    });

    if (data.status !== "1") return 0.0;

    const raw = data.result ?? "0";
    const decimals = getTokenDecimals(contract);
    const parsed = Number(raw) / 10 ** decimals;
    return Number.isFinite(parsed) ? Math.round(parsed * 1e8) / 1e8 : 0.0;
  } catch {
    return 0.0;
  }
};

export const scanEvmAddresses = async (
  apiKey: string,
  addresses: string[],
  tokens: TokenConfig[],
  intervalMs = 350
): Promise<EvmAddressBalance[]> => {
  if (addresses.length === 0) return [];

  // Phase 1: ETH balances via balancemulti (up to 20 addresses per call)
  const batchSize = 20;
  const ethBalanceMap = new Map<string, number>();

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const batchMap = await queryEthBalances(apiKey, batch);
    for (const [addr, bal] of batchMap) {
      ethBalanceMap.set(addr, bal);
    }

    if (i + batchSize < addresses.length) {
      await sleep(intervalMs);
    }
  }

  // Phase 2: token balances for each address
  const results: EvmAddressBalance[] = [];
  let firstToken = true;

  for (const address of addresses) {
    const addrLower = address.toLowerCase();
    const ethBalance = ethBalanceMap.get(addrLower) ?? 0.0;

    const entry: EvmAddressBalance = {
      address,
      native_balance: Math.round(ethBalance * 1e8) / 1e8,
      usdt: 0.0,
      usdc: 0.0,
      raw_tokens: [],
    };

    for (const token of tokens) {
      if (!firstToken) {
        await sleep(intervalMs);
      }
      firstToken = false;

      const balance = await queryTokenBalance(apiKey, address, token.contract);

      if (token.symbol === "USDT") entry.usdt = balance;
      else if (token.symbol === "USDC") entry.usdc = balance;
    }

    results.push(entry);
  }

  return results;
};
