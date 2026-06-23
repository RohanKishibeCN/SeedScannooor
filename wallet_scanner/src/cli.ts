#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import cliProgress from "cli-progress";
import { loadConfig } from "./config.js";
import { scanEvmAddresses } from "./evm.js";
import { calculateTotalUsd, getPrices, shouldKeep } from "./filter.js";
import { deriveAddresses, loadMnemonics } from "./mnemonic.js";
import { batchWriteToNotion } from "./notion.js";
import { aggregateResults, formatFilename, getTimestamp, writeCsvOutput } from "./output.js";
import { scanSolanaAddresses } from "./solana.js";
import type { AggregatedResult, Chain, NotionPageData } from "./types.js";
import { ShutdownFlag } from "./utils.js";

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
  scanIntervalMs: number,
  etherscanApiKey: string,
  etherscanIntervalMs: number,
  heliusRpcUrl: string,
  ethTokens: any[],
  solTokens: any[],
  prices: Record<string, number>,
  thresholdUsd: number,
  shutdown: ShutdownFlag
): Promise<{ allAddresses: Record<string, any[]>; totalUsd: number } | null> => {
  if (shutdown.isRequested()) return null;

  const derived = deriveAddresses(mnemonicStr, chains, depth);

  const evmChains = chains.filter((c) => c !== "solana");
  const scanSolana = chains.includes("solana");

  const tasks: Array<Promise<[string, any[]]>> = [];

  for (const chain of evmChains) {
    const addrs = derived[chain];
    if (addrs && addrs.length > 0) {
      tasks.push(
        scanEvmAddresses(etherscanApiKey, addrs, ethTokens, etherscanIntervalMs).then((r) => [chain, r])
      );
    }
  }

  if (scanSolana) {
    const addrs = derived.solana;
    if (addrs && addrs.length > 0) {
      tasks.push(
        scanSolanaAddresses(heliusRpcUrl, addrs, solTokens, maxConcurrent, scanIntervalMs).then(
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
    .description("Wallet Scanner - scan crypto wallet balances")
    .requiredOption("--mnemonic-file <path>", "path to mnemonic file (one per line)")
    .option("--config <path>", "YAML config file path (optional)")
    .option("--chains <chains>", "comma-separated chains to scan, e.g. ethereum,bsc,solana")
    .option("--depth <number>", "derivation depth (default from .env SCAN_DEPTH)", (v) => Number.parseInt(v, 10))
    .option("--output-dir <path>", "output directory (default ./results)", "./results")
    .option("--threshold <number>", "USD threshold (default from .env THRESHOLD_USD)", (v) => Number.parseFloat(v))
    .option("--notion-only", "write to Notion only (skip local file output)", false);

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
    console.log("No mnemonics found or file is empty");
    process.exitCode = 0;
    return;
  }

  console.log(`Loaded ${mnemonics.length} mnemonics`);
  console.log(`Chains: ${cfg.chains.join(", ")}`);
  console.log(`Depth: ${cfg.depth}`);
  console.log(`USD threshold: $${cfg.thresholdUsd}`);
  console.log(`Etherscan tokens: ${cfg.ethTokens.map((t) => t.symbol).join(", ")}`);
  if (cfg.chains.includes("solana")) {
    console.log(`Solana tokens: ${cfg.solTokens.map((t) => t.symbol).join(", ")}`);
  }

  const prices = await getPrices();
  console.log(
    `Prices: ETH=$${(prices.ethereum ?? 0).toFixed(2)}, SOL=$${(prices.solana ?? 0).toFixed(2)}, USDT=$${(prices.tether ?? 0).toFixed(4)}`
  );

  const snapshotTime = getTimestamp();
  const shutdown = new ShutdownFlag();

  const onSignal = () => {
    if (!shutdown.isRequested()) {
      shutdown.request();
      process.stdout.write("\nReceived shutdown signal, finishing current task...\n");
    }
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  fs.mkdirSync(cfg.outputDir, { recursive: true });

  const jsonlPath = path.join(cfg.outputDir, `${formatFilename()}_scan_results.jsonl`);

  const notionPages: NotionPageData[] = [];
  let passedCount = 0;

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
      cfg.etherscanApiKey,
      cfg.etherscanIntervalMs,
      cfg.heliusRpcUrl,
      cfg.ethTokens,
      cfg.solTokens,
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

      // Immediate JSONL write
      const jsonlLine = JSON.stringify(aggregated) + "\n";
      fs.appendFileSync(jsonlPath, jsonlLine, "utf-8");

      if (opts.notionOnly) {
        notionPages.push(...buildNotionPages(allAddresses, totalUsd, lineNum, snapshotTime));
      }
    }
  }

  if (bar) {
    bar.stop();
  }

  // Notion batch write
  if (notionPages.length > 0) {
    console.log("\nWriting to Notion...");
    const { success, failed } = await batchWriteToNotion(
      cfg.notionApiKey,
      cfg.notionDatabaseId,
      notionPages,
      "failed_notion_writes.jsonl",
      cfg.maxConcurrent
    );
    console.log(`Notion written: ${success} pages (${failed} failed)`);
  }

  // Final output
  const scanTimeStr = getTimestamp();
  let csvPath: string | undefined;

  if (!opts.notionOnly) {
    const results: AggregatedResult[] = [];

    // Read back from JSONL for CSV output
    try {
      const jsonlContent = fs.readFileSync(jsonlPath, "utf-8");
      const lines = jsonlContent.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          results.push(JSON.parse(line));
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // jsonl file might not exist
    }

    if (results.length > 0) {
      csvPath = writeCsvOutput(cfg.outputDir, results, scanTimeStr);
    }
  }

  const totalScanned = opts.notionOnly ? passedCount : 0;

  console.log("\nScan complete!");
  console.log(`Total mnemonics scanned: ${mnemonics.length}`);
  console.log(`Passed threshold: ${passedCount}`);
  if (csvPath) console.log(`CSV output: ${csvPath}`);
  if (jsonlPath && fs.existsSync(jsonlPath)) console.log(`JSONL output: ${jsonlPath}`);
};

main().catch((e) => {
  process.stderr.write(`\nError: ${String(e)}\n`);
  process.exitCode = 1;
});
