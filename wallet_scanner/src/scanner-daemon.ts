#!/usr/bin/env node
/**
 * SeedScannooor Scanner Daemon
 *
 * 持续运行的守护进程，自动管理：
 *  - 随机助记词扫描（每天 ~2,000 条）
 *  - 暴力破解补全扫描（每天 ~19,900 条，前8个词固定）
 *  - Etherscan 速率控制（~370ms/次，每日上限 90,000）
 *  - 发现钱包立即写入 found_wallets.txt
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import bip39 from "bip39";

import { loadConfig } from "./config.js";
import { scanEvmAddresses } from "./evm.js";
import { calculateTotalUsd, getPrices } from "./filter.js";
import { deriveAddresses } from "./mnemonic.js";
import { scanSolanaAddresses } from "./solana.js";
import type { Chain, EvmAddressBalance, SolanaAddressBalance } from "./types.js";

// ── 固定前8个助记词（暴力破解前缀）──
const KNOWN_WORDS = ["fault", "door", "pride", "design", "claw", "naive", "raccoon", "price"];

// ── 核心参数 ──
const BATCH_SIZE = 10;                        // 每批 10 条助记词
const DEPTH = 2;                               // depth=2（ETH+SOL 各2地址）
const ETHERSCAN_INTERVAL = 370;              // Etherscan 调用间隔（10% 余量）
const DAILY_LIMIT = 90_000;                  // 每日调用上限（10% 余量）
const MAX_RANDOM_DAILY = 2_000;             // 每天随机助记词上限
const SOL_CONCURRENT = 3;                     // Solana RPC 并发
const SOL_INTERVAL = 0;                       // Solana 间隔（Helius 额度充裕）
const PRICE_REFRESH = 30 * 60 * 1000;         // 价格缓存 30 分钟
const STATUS_INTERVAL = 5 * 60 * 1000;        // 每5分钟刷一次状态文件

const FOUND_FILE = path.join(process.cwd(), "found_wallets.txt");
const STATUS_FILE = path.join(process.cwd(), "daemon_status.json");
const PID_FILE = path.join(process.cwd(), "scanner_daemon.pid");

// ── 状态 ──
let etherscanCallsToday = 0;
let randomCountToday = 0;
let bruteCountToday = 0;
let foundWallets = 0;
let lastBatchTime = 0;
let prices: Record<string, number> = {};
let pricesLastUpdated = 0;
let shutdownRequested = false;

// ── 辅助函数 ──

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const timestamp = (): string =>
  new Date().toISOString().replace(/T/, " ").replace(/\.\d{3}Z$/, " UTC");

const utcMidnight = (): Date => {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return utc;
};

/**
 * 生成一条前8个词固定的 BIP39 助记词
 * 后4个词随机，由 bip39.entropyToMnemonic 计算 checksum 并补全
 */
const generateBruteMnemonic = (): string => {
  const entropy = Buffer.alloc(16);

  let combined = 0n;
  for (const word of KNOWN_WORDS) {
    const idx = bip39.wordlists.english.indexOf(word);
    combined = (combined << 11n) | BigInt(idx);
  }

  for (let i = 0; i < 11; i++) {
    const shift = BigInt((10 - i) * 8);
    entropy[i] = Number((combined >> shift) & 0xFFn);
  }

  const rand = randomBytes(5);
  rand.copy(entropy, 11);

  return bip39.entropyToMnemonic(entropy);
};

/**
 * 写守护进程状态 JSON
 */
const writeStatus = (
  status: "STARTING" | "RUNNING" | "PAUSED" | "STOPPED"
): void => {
  const upsec = Math.floor((Date.now() - (process as any)._startTime) / 1000);
  const upH = Math.floor(upsec / 3600);
  const upM = Math.floor((upsec % 3600) / 60);
  const upS = upsec % 60;
  const uptime = `${String(upH).padStart(2, "0")}:${String(upM).padStart(2, "0")}:${String(upS).padStart(2, "0")}`;

  const obj = {
    status,
    uptime,
    timestamp: timestamp(),
    etherscan_calls_today: etherscanCallsToday,
    etherscan_limit: DAILY_LIMIT,
    etherscan_percent: ((etherscanCallsToday / DAILY_LIMIT) * 100).toFixed(1),
    random_count_today: randomCountToday,
    brute_count_today: bruteCountToday,
    total_mnemonics_today: randomCountToday + bruteCountToday,
    found_wallets: foundWallets,
    last_batch_time_ms: lastBatchTime,
    prices_last_updated: pricesLastUpdated
      ? new Date(pricesLastUpdated).toISOString()
      : null,
  };

  fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 2) + "\n", "utf-8");
};

/**
 * 写找到的钱包到 found_wallets.txt
 */
const writeFound = (
  mnemonic: string,
  chain: string,
  address: string,
  totalUsd: number,
  pricesSnapshot: Record<string, number>
): void => {
  const line = [
    timestamp(),
    mnemonic,
    chain,
    address,
    `$${totalUsd.toFixed(2)}`,
  ].join(" | ");

  // 首次写入时加表头
  if (!fs.existsSync(FOUND_FILE)) {
    const header =
      "# SeedScannooor Found Wallets\n" +
      "# 时间 UTC | 助记词 | 链 | 地址 | USD 估值\n" +
      "# Prices: ETH=$" +
      (pricesSnapshot.ethereum ?? 0).toFixed(2) +
      " SOL=$" +
      (pricesSnapshot.solana ?? 0).toFixed(2) +
      "\n";
    fs.writeFileSync(FOUND_FILE, header, "utf-8");
  }

  fs.appendFileSync(FOUND_FILE, line + "\n", "utf-8");
  foundWallets += 1;
};

/**
 * 写入 PID 文件
 */
const writePidFile = (): void => {
  fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
};

const removePidFile = (): void => {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
};

// ── 主逻辑 ──

const main = async (): Promise<void> => {
  console.log(`[${timestamp()}] Scanner daemon starting...`);

  // 防重复启动
  if (fs.existsSync(PID_FILE)) {
    const oldPid = fs.readFileSync(PID_FILE, "utf-8").trim();
    try {
      process.kill(Number(oldPid), 0);
      console.error(`[${timestamp()}] Another instance is already running (PID=${oldPid}). Exiting.`);
      process.exit(1);
    } catch {
      // old PID is stale, continue
    }
  }

  writePidFile();
  (process as any)._startTime = Date.now();

  // 信号处理
  const onShutdown = () => {
    if (!shutdownRequested) {
      shutdownRequested = true;
      console.log(`\n[${timestamp()}] Shutting down gracefully...`);
    }
  };
  process.on("SIGINT", onShutdown);
  process.on("SIGTERM", onShutdown);
  process.on("uncaughtException", (err) => {
    console.error(`[${timestamp()}] Uncaught exception:`, err.message);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(`[${timestamp()}] Unhandled rejection:`, reason);
  });

  // 加载配置
  const cfg = loadConfig();
  console.log(`[${timestamp()}] Config loaded`);
  console.log(`  Chains: ${cfg.chains.join(", ")}`);
  console.log(`  Depth: ${DEPTH}`);
  console.log(`  ETH tokens: ${cfg.ethTokens.map((t) => t.symbol).join(", ")}`);
  console.log(`  SOL tokens: ${cfg.solTokens.map((t) => t.symbol).join(", ")}`);
  console.log(`  Threshold: $${cfg.thresholdUsd}`);
  console.log(`  Etherscan interval: ${ETHERSCAN_INTERVAL}ms`);
  console.log(`  Daily limit: ${DAILY_LIMIT} calls`);
  console.log(`  Max random/day: ${MAX_RANDOM_DAILY}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  SOL concurrent: ${SOL_CONCURRENT}`);

  // 初始价格
  prices = await getPrices();
  pricesLastUpdated = Date.now();
  console.log(
    `[${timestamp()}] Initial prices: ETH=$${(prices.ethereum ?? 0).toFixed(2)}, ` +
      `SOL=$${(prices.solana ?? 0).toFixed(2)}`
  );

  writeStatus("RUNNING");

  // 创建空结果文件（Lark 需要始终能读到这个文件）
  if (!fs.existsSync(FOUND_FILE)) {
    fs.writeFileSync(
      FOUND_FILE,
      "# SeedScannooor Found Wallets\n" +
        "# 时间 UTC | 助记词 | 链 | 地址 | USD 估值\n" +
        "# （尚未发现符合条件的钱包）\n",
      "utf-8"
    );
  }

  let lastStatusTime = Date.now();

  // ── 主循环 ──
  while (!shutdownRequested) {
    // ── 检查每日上限 ──
    if (etherscanCallsToday >= DAILY_LIMIT) {
      const midnight = utcMidnight();
      const waitMs = midnight.getTime() - Date.now();
      const waitMin = Math.round(waitMs / 60_000);
      console.log(
        `[${timestamp()}] Daily limit reached (${etherscanCallsToday}/${DAILY_LIMIT}). ` +
          `Sleeping until next UTC midnight (~${waitMin} min)...`
      );
      writeStatus("PAUSED");

      // 分段 sleep，每 10 秒检查一次 shutdown 信号
      while (Date.now() < midnight.getTime() && !shutdownRequested) {
        await sleep(10_000);
      }

      if (shutdownRequested) break;

      etherscanCallsToday = 0;
      randomCountToday = 0;
      bruteCountToday = 0;
      console.log(`[${timestamp()}] New day! Counters reset.`);
      writeStatus("RUNNING");
      continue;
    }

    // ── 刷新价格 ──
    if (Date.now() - pricesLastUpdated > PRICE_REFRESH) {
      prices = await getPrices();
      pricesLastUpdated = Date.now();
      console.log(
        `[${timestamp()}] Prices refreshed: ETH=$${(prices.ethereum ?? 0).toFixed(2)} ` +
          `SOL=$${(prices.solana ?? 0).toFixed(2)}`
      );
    }

    // ── 定期写状态文件 ──
    if (Date.now() - lastStatusTime > STATUS_INTERVAL) {
      writeStatus("RUNNING");
      lastStatusTime = Date.now();
    }

    // ── 准备一批助记词 ──
    const batchMnemonics: Array<{ type: "random" | "brute"; words: string }> = [];
    for (let i = 0; i < BATCH_SIZE && !shutdownRequested; i++) {
      if (randomCountToday < MAX_RANDOM_DAILY) {
        batchMnemonics.push({ type: "random", words: bip39.generateMnemonic(128) });
        randomCountToday++;
      } else {
        batchMnemonics.push({ type: "brute", words: generateBruteMnemonic() });
        bruteCountToday++;
      }
    }

    if (shutdownRequested) break;

    if (batchMnemonics.length === 0) continue;

    // ── 派生地址 ──
    const batchStart = Date.now();

    // 建立 地址(mnemonicIndex, chain) 映射
    const addressMap = new Map<
      string,
      { mnemonicIndex: number; chain: string }
    >();
    const evmChains = cfg.chains.filter((c) => c !== "solana");
    const scanSol = cfg.chains.includes("solana");
    const allEvmAddrs: string[] = [];
    const allSolAddrs: string[] = [];

    for (let i = 0; i < batchMnemonics.length; i++) {
      const derived = deriveAddresses(batchMnemonics[i]!.words, cfg.chains, DEPTH);

      for (const evmChain of evmChains) {
        for (const addr of derived[evmChain] ?? []) {
          allEvmAddrs.push(addr);
          addressMap.set(addr.toLowerCase(), {
            mnemonicIndex: i,
            chain: evmChain,
          });
        }
      }

      if (scanSol) {
        for (const addr of derived.solana ?? []) {
          allSolAddrs.push(addr);
          addressMap.set(addr.toLowerCase(), {
            mnemonicIndex: i,
            chain: "solana",
          });
        }
      }
    }

    // ── 扫描 EVM（全局 Etherscan 速率控制）──
    const evmPromise: Promise<EvmAddressBalance[]> =
      allEvmAddrs.length > 0
        ? scanEvmAddresses(
            cfg.etherscanApiKey,
            allEvmAddrs,
            cfg.ethTokens,
            ETHERSCAN_INTERVAL
          )
        : Promise.resolve([]);

    // ── 扫描 Solana（独立速率控制）──
    const solPromise: Promise<SolanaAddressBalance[]> =
      scanSol && allSolAddrs.length > 0
        ? scanSolanaAddresses(
            cfg.heliusRpcUrl,
            allSolAddrs,
            cfg.solTokens,
            SOL_CONCURRENT,
            SOL_INTERVAL
          )
        : Promise.resolve([]);

    // ── 并行执行 ──
    const [evmResults, solResults] = await Promise.all([
      evmPromise,
      solPromise,
    ]);

    // ── 更新 Etherscan 调用量 ──
    const ethBalanceCalls = Math.ceil(allEvmAddrs.length / 20);
    const tokenBalanceCalls = allEvmAddrs.length * cfg.ethTokens.length;
    etherscanCallsToday += ethBalanceCalls + tokenBalanceCalls;

    lastBatchTime = Date.now() - batchStart;

    // ── 按助记词汇总结果 ──
    const mnemonicResults: Map<
      number,
      Array<
        | ({ chain: Exclude<Chain, "solana"> } & EvmAddressBalance)
        | ({ chain: "solana" } & SolanaAddressBalance)
      >
    > = new Map();

    for (const r of evmResults) {
      const info = addressMap.get(r.address.toLowerCase());
      if (info) {
        const list = mnemonicResults.get(info.mnemonicIndex) ?? [];
        list.push({ ...r, chain: info.chain as Exclude<Chain, "solana"> } as any);
        mnemonicResults.set(info.mnemonicIndex, list);
      }
    }

    for (const r of solResults) {
      const info = addressMap.get(r.address.toLowerCase());
      if (info) {
        const list = mnemonicResults.get(info.mnemonicIndex) ?? [];
        list.push({ ...r, chain: "solana" } as any);
        mnemonicResults.set(info.mnemonicIndex, list);
      }
    }

    // ── 检查阈值 & 写入 found_wallets.txt ──
    for (let i = 0; i < batchMnemonics.length; i++) {
      const addrs = mnemonicResults.get(i) ?? [];
      if (addrs.length === 0) continue;

      const totalUsd = calculateTotalUsd(addrs as any, prices);
      if (totalUsd >= cfg.thresholdUsd) {
        const mnemonic = batchMnemonics[i]!.words;
        const nonZero = addrs.filter(
          (a: any) =>
            (a.native_balance ?? a.sol ?? 0) > 0 ||
            (a.usdt ?? 0) > 0 ||
            (a.usdc ?? 0) > 0
        );

        for (const a of nonZero as any[]) {
          writeFound(mnemonic, a.chain, a.address, totalUsd, prices);
        }

        console.log(
          `[${timestamp()}] FOUND WALLET! mnemonic=${mnemonic.slice(0, 40)}... totalUsd=$${totalUsd.toFixed(2)}`
        );
      }
    }

    // ── 打印进度 ──
    const totalToday = randomCountToday + bruteCountToday;
    if (totalToday % 100 === 0 || totalToday <= 10) {
      console.log(
        `[${timestamp()}] Progress: ${totalToday} mnemonics today ` +
          `(${randomCountToday} random + ${bruteCountToday} brute), ` +
          `Etherscan: ${etherscanCallsToday}/${DAILY_LIMIT} calls ` +
          `(${((etherscanCallsToday / DAILY_LIMIT) * 100).toFixed(1)}%), ` +
          `last batch: ${lastBatchTime}ms`
      );
    }

    if (shutdownRequested) break;
  }

  // ── 优雅关闭 ──
  console.log(`[${timestamp()}] Final stats:`);
  console.log(`  Total today: ${randomCountToday + bruteCountToday} mnemonics`);
  console.log(`  Etherscan used: ${etherscanCallsToday}/${DAILY_LIMIT}`);
  console.log(`  Wallets found: ${foundWallets}`);
  writeStatus("STOPPED");
  removePidFile();
  console.log(`[${timestamp()}] Daemon stopped.`);
};

main().catch((e) => {
  console.error(`[${timestamp()}] Fatal error:`, e);
  process.exit(1);
});
