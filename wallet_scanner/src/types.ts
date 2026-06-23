export type Chain = "ethereum" | "bsc" | "polygon" | "arbitrum" | "base" | "solana";

export type Prices = Record<string, number>;

export interface TokenConfig {
  symbol: string;
  contract: string;
}

export interface Config {
  etherscanApiKey: string;
  heliusRpcUrl: string;
  notionApiKey: string;
  notionDatabaseId: string;
  chains: Chain[];
  depth: number;
  outputDir: string;
  thresholdUsd: number;
  maxConcurrent: number;
  scanIntervalMs: number;
  etherscanIntervalMs: number;
  ethTokens: TokenConfig[];
  solTokens: TokenConfig[];
}

export interface EvmAddressBalance {
  address: string;
  native_balance: number;
  usdt: number;
  usdc: number;
  raw_tokens: unknown[];
}

export interface SolanaAddressBalance {
  address: string;
  sol: number;
  usdt: number;
  usdc: number;
}

export type AddressBalanceWithChain =
  | ({ chain: Exclude<Chain, "solana"> } & EvmAddressBalance)
  | ({ chain: "solana" } & SolanaAddressBalance);

export interface AggregatedAddressEntry {
  chain: Chain;
  address: string;
  usdt: number;
  usdc: number;
  total_usd_value: number;
  native_balance?: number;
  sol_balance?: number;
}

export interface AggregatedResult {
  mnemonic_index: number;
  addresses: AggregatedAddressEntry[];
  total_usd_value: number;
  snapshot_time: string;
}

export interface NotionPageData {
  mnemonic_index: number;
  chain: Chain;
  address: string;
  native_balance: number;
  usdt: number;
  usdc: number;
  total_usd: number;
  snapshot_time: string;
}
