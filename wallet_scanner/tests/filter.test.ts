import { describe, expect, it } from "vitest";
import { calculateTotalUsd, shouldKeep } from "../src/filter.js";

describe("filter", () => {
  it("shouldKeep threshold works", () => {
    expect(shouldKeep(9.99, 10.0)).toBe(false);
    expect(shouldKeep(10.0, 10.0)).toBe(true);
    expect(shouldKeep(10.01, 10.0)).toBe(true);
    expect(shouldKeep(0.0, 10.0)).toBe(false);
  });

  it("calculateTotalUsd includes native + stablecoins", () => {
    const addresses: any[] = [
      { chain: "ethereum", native_balance: 1.0, usdt: 0.0, usdc: 0.0 },
      { chain: "solana", sol: 2.0, usdt: 100.0, usdc: 50.0 }
    ];
    const prices: any = {
      ethereum: 3000.0,
      binancecoin: 600.0,
      solana: 150.0,
      tether: 1.0,
      "usd-coin": 1.0
    };
    expect(calculateTotalUsd(addresses, prices)).toBe(3450.0);
  });
});

