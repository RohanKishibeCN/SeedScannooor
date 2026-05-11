import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import dotenv from "dotenv";
const TATUM_API_KEY_ENV = "TATUM_API_KEY";
const HELIUS_RPC_URL_ENV = "HELIUS_RPC_URL";
const NOTION_API_KEY_ENV = "NOTION_API_KEY";
const NOTION_DATABASE_ID_ENV = "NOTION_DATABASE_ID";
const DEPTH_ENV_KEY = "SCAN_DEPTH";
const THRESHOLD_USD_ENV_KEY = "THRESHOLD_USD";
const MAX_CONCURRENT_ENV_KEY = "MAX_CONCURRENT";
const SCAN_INTERVAL_MS_ENV_KEY = "SCAN_INTERVAL_MS";
const DEFAULT_CHAINS = ["ethereum", "solana"];
const DEFAULT_DEPTH = 20;
const DEFAULT_OUTPUT_DIR = "./results";
const DEFAULT_THRESHOLD_USD = 10.0;
const DEFAULT_MAX_CONCURRENT = 10;
const DEFAULT_SCAN_INTERVAL_MS = 100;
const CHAIN_ENABLE_ENV_KEYS = {
    ethereum: "CHAIN_ETHEREUM",
    bsc: "CHAIN_BSC",
    polygon: "CHAIN_POLYGON",
    arbitrum: "CHAIN_ARBITRUM",
    base: "CHAIN_BASE",
    solana: "CHAIN_SOLANA"
};
const ALL_SUPPORTED_CHAINS = [
    "ethereum",
    "bsc",
    "polygon",
    "arbitrum",
    "base",
    "solana"
];
const parseEnabled = (value) => {
    const v = (value ?? "").toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
};
const loadEnvFiles = () => {
    const localEnv = path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".env");
    const cwdEnv = path.join(process.cwd(), ".env");
    if (fs.existsSync(localEnv)) {
        dotenv.config({ path: localEnv });
    }
    if (fs.existsSync(cwdEnv) && cwdEnv !== localEnv) {
        dotenv.config({ path: cwdEnv });
    }
};
const findConfigYaml = (configPath) => {
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
const loadYamlConfig = (configPath) => {
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
        return parsed;
    }
    catch (e) {
        throw new Error(`Failed to parse config.yaml: ${String(e)}`);
    }
};
const resolveOverride = (envValue, yamlValue, cliValue, defaultValue) => {
    if (cliValue !== undefined)
        return cliValue;
    if (envValue !== undefined)
        return envValue;
    if (yamlValue !== undefined)
        return yamlValue;
    return defaultValue;
};
const loadRequiredEnv = (key) => {
    const v = process.env[key];
    if (!v) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return v;
};
const loadOptionalInt = (key) => {
    const v = process.env[key];
    if (!v)
        return undefined;
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) {
        throw new Error(`Environment variable ${key} must be an integer, got: ${v}`);
    }
    return n;
};
const loadOptionalFloat = (key) => {
    const v = process.env[key];
    if (!v)
        return undefined;
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n)) {
        throw new Error(`Environment variable ${key} must be a float, got: ${v}`);
    }
    return n;
};
const loadEnabledChains = () => {
    const enabled = [];
    for (const chain of ALL_SUPPORTED_CHAINS) {
        if (parseEnabled(process.env[CHAIN_ENABLE_ENV_KEYS[chain]])) {
            enabled.push(chain);
        }
    }
    return enabled.length > 0 ? enabled : [...DEFAULT_CHAINS];
};
export const loadConfig = (input = {}) => {
    loadEnvFiles();
    const y = loadYamlConfig(input.configPath);
    const tatumApiKey = loadRequiredEnv(TATUM_API_KEY_ENV);
    const heliusRpcUrl = loadRequiredEnv(HELIUS_RPC_URL_ENV);
    const notionApiKey = loadRequiredEnv(NOTION_API_KEY_ENV);
    const notionDatabaseId = loadRequiredEnv(NOTION_DATABASE_ID_ENV);
    const enabledChains = loadEnabledChains();
    const finalChains = resolveOverride(undefined, y.chains, input.chains, enabledChains);
    const envDepth = loadOptionalInt(DEPTH_ENV_KEY);
    const envThresholdUsd = loadOptionalFloat(THRESHOLD_USD_ENV_KEY);
    const envMaxConcurrent = loadOptionalInt(MAX_CONCURRENT_ENV_KEY);
    const envScanIntervalMs = loadOptionalInt(SCAN_INTERVAL_MS_ENV_KEY);
    return {
        tatumApiKey,
        heliusRpcUrl,
        notionApiKey,
        notionDatabaseId,
        chains: finalChains,
        depth: resolveOverride(envDepth, y.depth, input.depth, DEFAULT_DEPTH),
        outputDir: resolveOverride(undefined, y.output_dir, input.outputDir, DEFAULT_OUTPUT_DIR),
        thresholdUsd: resolveOverride(envThresholdUsd, y.threshold_usd, input.thresholdUsd, DEFAULT_THRESHOLD_USD),
        maxConcurrent: resolveOverride(envMaxConcurrent, y.max_concurrent, input.maxConcurrent, DEFAULT_MAX_CONCURRENT),
        scanIntervalMs: resolveOverride(envScanIntervalMs, y.scan_interval_ms, input.scanIntervalMs, DEFAULT_SCAN_INTERVAL_MS)
    };
};
