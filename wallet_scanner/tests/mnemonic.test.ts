import { describe, expect, it } from "vitest";
import { deriveAddresses, loadMnemonics } from "../src/mnemonic.js";

describe("mnemonic", () => {
  const TEST_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

  it("deriveAddresses returns all chains with requested depth", () => {
    const result = deriveAddresses(TEST_MNEMONIC, 3);
    expect(Object.keys(result).sort()).toEqual(
      ["arbitrum", "base", "bsc", "ethereum", "polygon", "solana"].sort()
    );
    for (const [_, addresses] of Object.entries(result)) {
      expect(addresses).toHaveLength(3);
    }
  });

  it("invalid mnemonic returns empty arrays", () => {
    const result = deriveAddresses("invalid mnemonic word", 2);
    for (const addresses of Object.values(result)) {
      expect(addresses).toEqual([]);
    }
  });

  it("loadMnemonics returns [] when file does not exist", () => {
    expect(loadMnemonics("/nonexistent/path/mnemonics.txt")).toEqual([]);
  });
});

