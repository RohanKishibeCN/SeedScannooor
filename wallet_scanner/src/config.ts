import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import dotenv from "dotenv";
import type { Chain, Config, TokenConfig } from "./types.js";

const ETHERSCAN_API_KEY_ENV = "ETHERSCAN_API_KEY";
const HELIUS_RPC_URL_ENV = "HELIUS_RPC_URL";

const NOTION_API_KEY_ENV = "NOTION_API_KEY";
const NOTION_DATABASE_ID_ENV = "NOTION_DATABASE_ID";

const DEPTH_ENV_KEY = "SCAN_DEPTH";
const THRESHOLD_USD_ENV_KEY = "THRESHOLD_USD";
const MAX_CONCURRENT_ENV_KEY = "MAX_CONCURRENT";
const SCAN_INTERVAL_MS_ENV_KEY = "SCAN_INTERVAL_MS";
const ETHERSCAN_INTERVAL_MS_ENV_KEY = "ETHERSCAN_INTERVAL_MS";

const ETH_TOKENS_ENV_KEY = "ETH_TOKENS";
const SOL_TOKENS_ENV_KEY = "SOL_TOKENS";

const DEFAULT_CHAINS: Chain[] = ["ethereum", "solana"];
const DEFAULT_DEPTH = 5;
const DEFAULT_OUTPUT_DIR = "./results";
const DEFAULT_THRESHOLD_USD = 5.0;
const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_SCAN_INTERVAL_MS = 3000;
const DEFAULT_ETHERSCAN_INTERVAL_MS = 350;

const CHAIN_ENABLE_ENV_KEYS: Record<Chain, string> = {
  ethereum: "CHAIN_ETHEREUM",
  bsc: "CHAIN_BSC",
  polygon: "CHAIN_POLYGON",
  arbitrum: "CHAIN_ARBITRUM",
  base: "CHAIN_BASE",
  solana: "CHAIN_SOLANA"
};

const ALL_SUPPORTED_CHAINS: Chain[] = [
  "ethereum",
  "bsc",
  "polygon",
  "arbitrum",
  "base",
  "solana"
];

type YamlConfig = Partial<{
  chains: Chain[];
  depth: number;
  output_dir: string;
  threshold_usd: number;
  max_concurrent: number;
  scan_interval_ms: number;
  etherscan_interval_ms: number;
}>;

const parseEnabled = (value: string | undefined): boolean => {
  const v = (value ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

const loadEnvFiles = (): void => {
  const localEnv = path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".env");
  const cwdEnv = path.join(process.cwd(), ".env");

  if (fs.existsSync(localEnv)) {
    dotenv.config({ path: localEnv });
  }
  if (fs.existsSync(cwdEnv) && cwdEnv !== localEnv) {
    dotenv.config({ path: cwdEnv });
  }
};

const findConfigYaml = (configPath?: string): string | undefined => {
  if (configPath) {
    return configPath;
  }

  const candidates = [
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "config.yaml"),
    path.join(process.cwd(), "config.yaml")
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
};

const loadYamlConfig = (configPath?: string): YamlConfig => {
  const yamlPath = findConfigYaml(configPath);
  if (!yamlPath) {
    return {};
  }

  try {
    const content = fs.readFileSync(yamlPath, "utf-8");
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as YamlConfig;
  } catch (e) {
    throw new Error(`Failed to parse config.yaml: ${String(e)}`);
  }
};

const resolveOverride = <T>(
  envValue: T | undefined,
  yamlValue: T | undefined,
  cliValue: T | undefined,
  defaultValue: T
): T => {
  if (cliValue !== undefined) return cliValue;
  if (envValue !== undefined) return envValue;
  if (yamlValue !== undefined) return yamlValue;
  return defaultValue;
};

const loadRequiredEnv = (key: string): string => {
  const v = process.env[key];
  if (!v) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
};

const loadOptionalInt = (key: string): number | undefined => {
  const v = process.env[key];
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${v}`);
  }
  return n;
};

const loadOptionalFloat = (key: string): number | undefined => {
  const v = process.env[key];
  if (!v) return undefined;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${key} must be a float, got: ${v}`);
  }
  return n;
};

const loadEnabledChains = (): Chain[] => {
  const enabled: Chain[] = [];
  for (const chain of ALL_SUPPORTED_CHAINS) {
    if (parseEnabled(process.env[CHAIN_ENABLE_ENV_KEYS[chain]])) {
      enabled.push(chain);
    }
  }
  return enabled.length > 0 ? enabled : [...DEFAULT_CHAINS];
};

const parseTokens = (raw: string | undefined): TokenConfig[] => {
  if (!raw || raw.trim() === "") return [];
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const tokens: TokenConfig[] = [];
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const symbol = part.slice(0, eqIdx).trim();
    const contract = part.slice(eqIdx + 1).trim();
    if (symbol && contract) {
      tokens.push({ symbol, contract });
    }
  }
  return tokens;
};

export interface LoadConfigInput {
  configPath?: string;
  chains?: Chain[];
  depth?: number;
  outputDir?: string;
  thresholdUsd?: number;
  maxConcurrent?: number;
  scanIntervalMs?: number;
}

export const loadConfig = (input: LoadConfigInput = {}): Config => {
  loadEnvFiles();
  const y = loadYamlConfig(input.configPath);

  const etherscanApiKey = loadRequiredEnv(ETHERSCAN_API_KEY_ENV);
  const heliusRpcUrl = loadRequiredEnv(HELIUS_RPC_URL_ENV);
  const notionApiKey = loadRequiredEnv(NOTION_API_KEY_ENV);
  const notionDatabaseId = loadRequiredEnv(NOTION_DATABASE_ID_ENV);

  const enabledChains = loadEnabledChains();
  const finalChains = resolveOverride<Chain[]>(
    undefined,
    y.chains,
    input.chains,
    enabledChains
  );

  const envDepth = loadOptionalInt(DEPTH_ENV_KEY);
  const envThresholdUsd = loadOptionalFloat(THRESHOLD_USD_ENV_KEY);
  const envMaxConcurrent = loadOptionalInt(MAX_CONCURRENT_ENV_KEY);
  const envScanIntervalMs = loadOptionalInt(SCAN_INTERVAL_MS_ENV_KEY);
  const envEtherscanIntervalMs = loadOptionalInt(ETHERSCAN_INTERVAL_MS_ENV_KEY);

  return {
    etherscanApiKey,
    heliusRpcUrl,
    notionApiKey,
    notionDatabaseId,
    chains: finalChains,
    depth: resolveOverride(envDepth, y.depth, input.depth, DEFAULT_DEPTH),
    outputDir: resolveOverride(undefined, y.output_dir, input.outputDir, DEFAULT_OUTPUT_DIR),
    thresholdUsd: resolveOverride(envThresholdUsd, y.threshold_usd, input.thresholdUsd, DEFAULT_THRESHOLD_USD),
    maxConcurrent: resolveOverride(envMaxConcurrent, y.max_concurrent, input.maxConcurrent, DEFAULT_MAX_CONCURRENT),
    scanIntervalMs: resolveOverride(envScanIntervalMs, y.scan_interval_ms, input.scanIntervalMs, DEFAULT_SCAN_INTERVAL_MS),
    etherscanIntervalMs: resolveOverride(envEtherscanIntervalMs, y.etherscan_interval_ms, undefined, DEFAULT_ETHERSCAN_INTERVAL_MS),
    ethTokens: parseTokens(process.env[ETH_TOKENS_ENV_KEY]),
    solTokens: parseTokens(process.env[SOL_TOKENS_ENV_KEY]),
  };
};
