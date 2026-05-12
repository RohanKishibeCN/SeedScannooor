import fs from "node:fs";
import path from "node:path";
import { stringify } from "csv-stringify/sync";
import type { AggregatedResult, Chain, EvmAddressBalance, SolanaAddressBalance } from "./types.js";

export const getTimestamp = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export const formatFilename = (): string => {
  const d = new Date();
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
};

export const aggregateResults = (
  allAddresses: Record<string, Array<EvmAddressBalance | SolanaAddressBalance>>,
  mnemonicIndex: number,
  snapshotTime: string
): AggregatedResult => {
  const addresses: AggregatedResult["addresses"] = [];

  for (const [chain, results] of Object.entries(allAddresses)) {
    for (const addrResult of results) {
      const address = (addrResult as any).address ?? "";
      const chainLower = chain.toLowerCase() as Chain;

      if (chainLower === "solana") {
        addresses.push({
          chain: chainLower,
          address,
          sol_balance: (addrResult as any).sol ?? 0.0,
          usdt: (addrResult as any).usdt ?? 0.0,
          usdc: (addrResult as any).usdc ?? 0.0,
          total_usd_value: 0.0
        });
      } else {
        addresses.push({
          chain: chainLower,
          address,
          native_balance: (addrResult as any).native_balance ?? 0.0,
          usdt: (addrResult as any).usdt ?? 0.0,
          usdc: (addrResult as any).usdc ?? 0.0,
          total_usd_value: 0.0
        });
      }
    }
  }

  return {
    mnemonic_index: mnemonicIndex,
    addresses,
    total_usd_value: 0.0,
    snapshot_time: snapshotTime
  };
};

export const writeJsonOutput = (
  outputDir: string,
  results: AggregatedResult[],
  thresholdUsd: number,
  scanTime?: string
): string => {
  const effectiveScanTime = scanTime ?? getTimestamp();
  fs.mkdirSync(outputDir, { recursive: true });

  const filename = `${formatFilename()}_scan_results.json`;
  const filepath = path.join(outputDir, filename);

  const totalScanned = results.length;
  const passed = results.filter((r) => (r.total_usd_value ?? 0.0) >= thresholdUsd).length;

  const output = {
    scan_time: effectiveScanTime,
    threshold_usd: thresholdUsd,
    total_scanned: totalScanned,
    passed,
    results
  };

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2), "utf-8");
  return filepath;
};

export const writeCsvOutput = (
  outputDir: string,
  results: AggregatedResult[],
  scanTime?: string
): string => {
  const effectiveScanTime = scanTime ?? getTimestamp();
  fs.mkdirSync(outputDir, { recursive: true });

  const filename = `${formatFilename()}_scan_results.csv`;
  const filepath = path.join(outputDir, filename);

  const rows: Array<Record<string, string | number>> = [];
  for (const result of results) {
    const mnemonicIndex = result.mnemonic_index;
    const snapshotTime = result.snapshot_time || effectiveScanTime;

    for (const addr of result.addresses) {
      const nativeBal = addr.chain === "solana" ? (addr.sol_balance ?? 0.0) : (addr.native_balance ?? 0.0);
      rows.push({
        mnemonic_index: mnemonicIndex,
        chain: addr.chain,
        address: addr.address,
        native_balance: nativeBal,
        usdt_balance: addr.usdt ?? 0.0,
        usdc_balance: addr.usdc ?? 0.0,
        total_usd_value: addr.total_usd_value ?? 0.0,
        snapshot_time: snapshotTime
      });
    }
  }

  const csv = stringify(rows, {
    header: true,
    columns: [
      "mnemonic_index",
      "chain",
      "address",
      "native_balance",
      "usdt_balance",
      "usdc_balance",
      "total_usd_value",
      "snapshot_time"
    ]
  });

  fs.writeFileSync(filepath, csv, "utf-8");
  return filepath;
};

