#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { Command } from "commander";
import cliProgress from "cli-progress";
import { loadConfig } from "./config.js";
import { scanEvmAddresses } from "./evm.js";
import { calculateTotalUsd, getPrices, shouldKeep } from "./filter.js";
import { deriveAddresses, loadMnemonics } from "./mnemonic.js";
import { batchWriteToNotion } from "./notion.js";
import { aggregateResults, formatFilename, getTimestamp, writeCsvOutput, writeJsonOutput } from "./output.js";
import { scanSolanaAddresses } from "./solana.js";
import type { Chain, NotionPageData } from "./types.js";
import { ShutdownFlag } from "./utils.js";

const SOLANA_MINT_ADDRESSES = {
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDg1v"
};

const parseChains = (chainsInput?: string): Chain[] | undefined => {
  if (!chainsInput) return undefined;
  const parts = chainsInput.split(",").map((c) => c.trim()).filter(Boolean);
  return parts as Chain[];
};

const buildNotionPages = (
  allAddresses: Record<string, any[]>,
  totalUsd: number,
  mnemonicIndex: number,
  snapshotTime: string
): NotionPageData[] => {
  const pages: NotionPageData[] = [];

  for (const [chain, addrList] of Object.entries(allAddresses)) {
    const chainName = chain.toLowerCase() as Chain;
    for (const addrInfo of addrList) {
      const nativeBalance =
        chainName === "solana" ? (addrInfo.sol ?? 0.0) : (addrInfo.native_balance ?? 0.0);

      pages.push({
        mnemonic_index: mnemonicIndex,
        chain: chainName,
        address: addrInfo.address ?? "",
        native_balance: nativeBalance,
        usdt: addrInfo.usdt ?? 0.0,
        usdc: addrInfo.usdc ?? 0.0,
        total_usd: totalUsd,
        snapshot_time: snapshotTime
      });
    }
  }

  return pages;
};

const scanMnemonic = async (
  mnemonicStr: string,
  chains: Chain[],
  depth: number,
  maxConcurrent: number,
  intervalMs: number,
  tatumApiKey: string,
  heliusRpcUrl: string,
  prices: Record<string, number>,
  thresholdUsd: number,
  shutdown: ShutdownFlag
): Promise<{ allAddresses: Record<string, any[]>; totalUsd: number } | null> => {
  if (shutdown.isRequested()) return null;

  const derived = deriveAddresses(mnemonicStr, depth);

  const evmChains = chains.filter((c) => c !== "solana");
  const scanSolana = chains.includes("solana");

  const tasks: Array<Promise<[string, any[]]>> = [];

  for (const chain of evmChains) {
    const addrs = derived[chain];
    if (addrs && addrs.length > 0) {
      tasks.push(
        scanEvmAddresses(tatumApiKey, addrs, chain, maxConcurrent, intervalMs).then((r) => [chain, r])
      );
    }
  }

  if (scanSolana) {
    const addrs = derived.solana;
    if (addrs && addrs.length > 0) {
      tasks.push(
        scanSolanaAddresses(heliusRpcUrl, addrs, SOLANA_MINT_ADDRESSES, maxConcurrent, intervalMs).then(
          (r) => ["solana", r]
        )
      );
    }
  }

  if (tasks.length === 0) return null;

  const settled = await Promise.allSettled(tasks);
  const allAddresses: Record<string, any[]> = {};
  for (const s of settled) {
    if (s.status === "fulfilled") {
      const [chainName, results] = s.value;
      allAddresses[chainName] = results;
    }
  }

  for (const c of [...evmChains, ...(scanSolana ? (["solana"] as const) : [])]) {
    if (!allAddresses[c]) allAddresses[c] = [];
  }

  const flat: any[] = [];
  for (const [chain, addrList] of Object.entries(allAddresses)) {
    for (const addrInfo of addrList) {
      flat.push({ ...addrInfo, chain });
    }
  }

  const totalUsd = calculateTotalUsd(flat, prices);
  if (!shouldKeep(totalUsd, thresholdUsd)) {
    return { allAddresses, totalUsd };
  }

  return { allAddresses, totalUsd };
};

const main = async (): Promise<void> => {
  const program = new Command();
  program
    .name("wallet-scanner")
    .description("Wallet Scanner - 扫描加密货币钱包余额")
    .requiredOption("--mnemonic-file <path>", "助记词文件路径（每行一条）")
    .option("--config <path>", "YAML 配置文件路径（可选）")
    .option("--chains <chains>", "扫描的链列表，逗号分隔，如 ethereum,bsc,solana")
    .option("--depth <number>", "派生地址数量（默认从 .env 的 SCAN_DEPTH 读取）", (v) => Number.parseInt(v, 10))
    .option("--output-dir <path>", "输出目录（默认 ./results）", "./results")
    .option("--threshold <number>", "USD 阈值（默认从 .env 的 THRESHOLD_USD 读取）", (v) => Number.parseFloat(v))
    .option("--notion-only", "仅写入 Notion（跳过本地文件输出）", false);

  program.parse(process.argv);
  const opts = program.opts<{
    mnemonicFile: string;
    config?: string;
    chains?: string;
    depth?: number;
    outputDir: string;
    threshold?: number;
    notionOnly: boolean;
  }>();

  const chains = parseChains(opts.chains);

  const cfg = loadConfig({
    configPath: opts.config,
    chains,
    depth: Number.isFinite(opts.depth as any) ? opts.depth : undefined,
    outputDir: opts.outputDir,
    thresholdUsd: Number.isFinite(opts.threshold as any) ? opts.threshold : undefined
  });

  const mnemonics = loadMnemonics(opts.mnemonicFile);
  if (mnemonics.length === 0) {
    console.log("未找到助记词或文件为空");
    return;
  }

  console.log(`加载了 ${mnemonics.length} 条助记词`);
  console.log(`扫描链: ${cfg.chains.join(", ")}`);
  console.log(`派生深度: ${cfg.depth}`);
  console.log(`USD 阈值: $${cfg.thresholdUsd}`);

  const prices = await getPrices();
  console.log(
    `当前价格: ETH=$${(prices.ethereum ?? 0).toFixed(2)}, SOL=$${(prices.solana ?? 0).toFixed(2)}, USDT=$${(prices.tether ?? 0).toFixed(4)}`
  );

  fs.mkdirSync(cfg.outputDir, { recursive: true });

  const results: any[] = [];
  const notionPages: NotionPageData[] = [];
  let passedCount = 0;

  const snapshotTime = getTimestamp();
  const shutdown = new ShutdownFlag();

  const onSignal = () => {
    if (!shutdown.isRequested()) {
      shutdown.request();
      process.stdout.write("\n收到退出信号，正在完成当前任务后退出...\n");
    }
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const isTty = Boolean(process.stdout.isTTY);
  const bar = isTty
    ? new cliProgress.SingleBar(
        { format: "Scanning mnemonics |{bar}| {value}/{total} {percentage}%" },
        cliProgress.Presets.shades_classic
      )
    : null;

  if (bar) {
    bar.start(mnemonics.length, 0);
  }

  for (let idx = 0; idx < mnemonics.length; idx += 1) {
    if (shutdown.isRequested()) {
      break;
    }

    const [lineNum, mnemonicStr] = mnemonics[idx]!;
    if (bar) {
      bar.update(idx + 1);
    } else if ((idx + 1) % 100 === 0 || idx + 1 === mnemonics.length) {
      console.log(`Scanning mnemonics: ${idx + 1}/${mnemonics.length}`);
    }

    const scanResult = await scanMnemonic(
      mnemonicStr,
      cfg.chains,
      cfg.depth,
      cfg.maxConcurrent,
      cfg.scanIntervalMs,
      cfg.tatumApiKey,
      cfg.heliusRpcUrl,
      prices,
      cfg.thresholdUsd,
      shutdown
    );

    if (!scanResult) continue;
    const { allAddresses, totalUsd } = scanResult;

    if (shouldKeep(totalUsd, cfg.thresholdUsd)) {
      passedCount += 1;
      const aggregated = aggregateResults(allAddresses, lineNum, snapshotTime);
      aggregated.total_usd_value = totalUsd;
      for (const addr of aggregated.addresses) {
        addr.total_usd_value = totalUsd;
      }

      if (opts.notionOnly) {
        notionPages.push(...buildNotionPages(allAddresses, totalUsd, lineNum, snapshotTime));
      } else {
        results.push(aggregated);
      }
    }
  }

  if (bar) {
    bar.stop();
  }

  const scanTimeStr = getTimestamp();
  if (notionPages.length > 0) {
    console.log("\n正在写入 Notion...");
    const { success, failed } = await batchWriteToNotion(
      cfg.notionApiKey,
      cfg.notionDatabaseId,
      notionPages,
      "failed_notion_writes.jsonl",
      cfg.maxConcurrent
    );
    console.log(`Notion written: ${success} pages (${failed} failed)`);
  }

  let jsonPath: string | undefined;
  let csvPath: string | undefined;

  if (!opts.notionOnly && results.length > 0) {
    jsonPath = writeJsonOutput(cfg.outputDir, results, cfg.thresholdUsd, scanTimeStr);
    csvPath = writeCsvOutput(cfg.outputDir, results, scanTimeStr);
  }

  const totalScanned = opts.notionOnly ? passedCount : results.length;

  console.log("\nScan complete!");
  console.log(`Total scanned: ${totalScanned}`);
  console.log(`Passed threshold: ${passedCount}`);
  if (jsonPath) console.log(`JSON output: ${jsonPath}`);
  if (csvPath) console.log(`CSV output: ${csvPath}`);
};

main().catch((e) => {
  process.stderr.write(`\n发生错误: ${String(e)}\n`);
  process.exitCode = 1;
});
