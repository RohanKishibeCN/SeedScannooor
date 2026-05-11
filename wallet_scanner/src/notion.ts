import fs from "node:fs";
import { Client } from "@notionhq/client";
import type { NotionPageData } from "./types.js";
import { Semaphore } from "./utils.js";

export const validateDatabase = async (notion: Client, databaseId: string): Promise<boolean> => {
  try {
    await notion.databases.query({ database_id: databaseId, page_size: 1 });
    return true;
  } catch {
    return false;
  }
};

const buildProperties = (pageData: NotionPageData): Record<string, unknown> => {
  return {
    MnemonicIndex: { number: pageData.mnemonic_index },
    WalletAddress: { title: [{ text: { content: pageData.address } }] },
    Chain: { select: { name: pageData.chain } },
    CoinBalance: { number: Math.round(pageData.native_balance * 1e8) / 1e8 },
    USDTBalance: { number: pageData.usdt },
    USDCBalance: { number: pageData.usdc },
    TotalUSDValue: { number: Math.round(pageData.total_usd * 1e2) / 1e2 },
    SnapshotTime: { date: { start: pageData.snapshot_time } },
    Status: { select: { name: "Passed" } }
  };
};

const writeFailedEntries = (failedLogPath: string, entries: unknown[]): void => {
  if (entries.length === 0) return;
  const lines = entries.map((e) => JSON.stringify(e) + "\n").join("");
  fs.appendFileSync(failedLogPath, lines, "utf-8");
};

export const batchWriteToNotion = async (
  notionApiKey: string,
  databaseId: string,
  pages: NotionPageData[],
  failedLogPath = "failed_notion_writes.jsonl",
  maxConcurrent = 10
): Promise<{ success: number; failed: number }> => {
  if (pages.length === 0) {
    return { success: 0, failed: 0 };
  }

  const notion = new Client({ auth: notionApiKey });
  const isValid = await validateDatabase(notion, databaseId);
  if (!isValid) {
    throw new Error(`Invalid database_id: ${databaseId}`);
  }

  const semaphore = new Semaphore(maxConcurrent);
  const timestamp = new Date().toISOString();

  const tasks = pages.map((pageData, index) =>
    semaphore.withLock(async () => {
      const payload = {
        parent: { database_id: databaseId },
        properties: buildProperties(pageData)
      };

      try {
        await notion.pages.create(payload as any);
        return { index, ok: true as const };
      } catch (e) {
        return { index, ok: false as const, error: String(e), pageData };
      }
    })
  );

  const settled = await Promise.allSettled(tasks);

  let success = 0;
  let failed = 0;
  const failedEntries: unknown[] = [];

  for (const s of settled) {
    if (s.status === "fulfilled") {
      if (s.value.ok) {
        success += 1;
      } else {
        failed += 1;
        failedEntries.push({
          timestamp,
          page_data: s.value.pageData,
          error: s.value.error
        });
      }
    } else {
      failed += 1;
      failedEntries.push({
        timestamp,
        page_data: {},
        error: String(s.reason)
      });
    }
  }

  writeFailedEntries(failedLogPath, failedEntries);
  return { success, failed };
};

