import { describe, expect, it } from "vitest";
import { aggregateResults, getTimestamp } from "../src/output.js";

describe("output", () => {
  it("aggregateResults matches expected shape and does not contain mnemonic words", () => {
    const allAddresses: any = {
      ethereum: [{ address: "0x1234567890abcdef", native_balance: 1.5, usdt: 100.0, usdc: 50.0 }],
      solana: [{ address: "Sol1234567890abcdef", sol: 2.0, usdt: 0.0, usdc: 25.0 }]
    };

    const result = aggregateResults(allAddresses, 1, "2024-01-01T00:00:00Z");
    expect(result).toHaveProperty("mnemonic_index");
    expect(result).toHaveProperty("addresses");
    expect(result).toHaveProperty("total_usd_value");
    expect(result).toHaveProperty("snapshot_time");

    const mnemonicWords = ["abandon", "about", "abroad", "abuse", "absent", "absorb", "abstract"];
    const serialized = JSON.stringify(result);
    for (const w of mnemonicWords) {
      expect(serialized.toLowerCase()).not.toContain(w);
    }
  });

  it("getTimestamp format is UTC ISO without milliseconds", () => {
    const timestamp = getTimestamp();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

