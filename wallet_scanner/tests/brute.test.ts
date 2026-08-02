import { describe, expect, it } from "vitest";
import bip39 from "bip39";
import { generateBruteMnemonic, KNOWN_WORDS } from "../src/brute.js";

describe("brute mnemonic generation (adversarial)", () => {
  it("every KNOWN_WORD exists in the BIP39 English wordlist", () => {
    const en = bip39.wordlists.english;
    for (const w of KNOWN_WORDS) {
      expect(en).toContain(w);
    }
  });

  it("20,000 samples: all valid BIP39, 12 words, fixed prefix, no collisions", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) {
      const m = generateBruteMnemonic();
      const words = m.split(" ");
      expect(words).toHaveLength(12);
      expect(words.slice(0, 8)).toEqual(KNOWN_WORDS);
      expect(bip39.validateMnemonic(m)).toBe(true);
      expect(seen.has(m)).toBe(false);
      seen.add(m);
    }
  });

  it("last 4 words vary (not stuck on a fixed word)", () => {
    const tailSet = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      const m = generateBruteMnemonic();
      tailSet.add(m.split(" ").slice(8).join(" "));
    }
    expect(tailSet.size).toBeGreaterThan(1_000);
  });
});
