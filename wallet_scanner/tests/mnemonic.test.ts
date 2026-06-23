import { describe, expect, it } from "vitest";
import { deriveAddresses, loadMnemonics } from "../src/mnemonic.js";
import type { Chain } from "../src/types.js";

describe("mnemonic", () => {
  const TEST_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

  const ALL_CHAINS: Chain[] = ["ethereum", "bsc", "polygon", "arbitrum", "base", "solana"];
  const ETH_SOL: Chain[] = ["ethereum", "solana"];

  it("deriveAddresses returns all specified chains with requested depth", () => {
    const result = deriveAddresses(TEST_MNEMONIC, ALL_CHAINS, 3);
    expect(Object.keys(result).sort()).toEqual(
      ["arbitrum", "base", "bsc", "ethereum", "polygon", "solana"].sort()
    );
    for (const [_, addresses] of Object.entries(result)) {
      expect(addresses).toHaveLength(3);
    }
  });

  it("deriveAddresses returns only ethereum and solana when specified", () => {
    const result = deriveAddresses(TEST_MNEMONIC, ETH_SOL, 2);
    expect(Object.keys(result).sort()).toEqual(["ethereum", "solana"].sort());
    expect(result.ethereum).toHaveLength(2);
    expect(result.solana).toHaveLength(2);
  });

  it("invalid mnemonic returns empty arrays for specified chains", () => {
    const result = deriveAddresses("invalid mnemonic word", ETH_SOL, 2);
    for (const c of ETH_SOL) {
      expect(result[c]).toEqual([]);
    }
  });

  it("loadMnemonics returns [] when file does not exist", () => {
    expect(loadMnemonics("/nonexistent/path/mnemonics.txt")).toEqual([]);
  });
});
