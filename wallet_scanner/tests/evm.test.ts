import { afterEach, describe, expect, it, vi } from "vitest";
import { scanEvmAddresses } from "../src/evm.js";
import type { TokenConfig } from "../src/types.js";

const TEST_TOKENS: TokenConfig[] = [
  { symbol: "USDT", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  { symbol: "USDC", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
];

describe("evm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("scanEvmAddresses returns entry even if request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 }))
    );

    const res = await scanEvmAddresses("key", ["0x123"], TEST_TOKENS, 0);
    expect(res).toHaveLength(1);
    expect(res[0]?.address).toBe("0x123");
    expect(res[0]?.native_balance).toBe(0.0);
    expect(res[0]?.usdt).toBe(0.0);
    expect(res[0]?.usdc).toBe(0.0);
  });

  it("scanEvmAddresses returns empty array for empty input", async () => {
    const res = await scanEvmAddresses("key", [], TEST_TOKENS, 0);
    expect(res).toEqual([]);
  });
});
