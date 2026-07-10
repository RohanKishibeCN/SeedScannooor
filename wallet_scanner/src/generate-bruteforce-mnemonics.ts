import fs from "node:fs";
import { randomBytes } from "node:crypto";
import process from "node:process";
import bip39 from "bip39";

const KNOWN_WORDS = ["fault", "door", "pride", "design", "claw", "naive", "raccoon", "price"];

const generateOneValidMnemonicWithFixedPrefix = (): string => {
  const entropy = Buffer.alloc(16);

  // First 8 known words → encode their 11-bit indices into entropy bits 0-87
  let combined = 0n;
  for (const word of KNOWN_WORDS) {
    const idx = bip39.wordlists.english.indexOf(word);
    combined = (combined << 11n) | BigInt(idx);
  }

  // Write 88 bits (11 bytes) into entropy[0..10]
  for (let i = 0; i < 11; i++) {
    const shift = BigInt((10 - i) * 8);
    entropy[i] = Number((combined >> shift) & 0xFFn);
  }

  // Generate 40 random bits for entropy bits 88-127 (bytes 11-15)
  const random = randomBytes(5);
  random.copy(entropy, 11);

  // bip39.entropyToMnemonic computes the checksum and produces a valid 12-word mnemonic
  // The first 8 words will match KNOWN_WORDS by construction
  return bip39.entropyToMnemonic(entropy);
};

const outputFile = process.argv[2] ?? "bruteforce_mnemonics.txt";

const cliCount = process.argv[3];
const envCount = process.env.BRUTE_COUNT;
const count = Number.parseInt(cliCount ?? envCount ?? "30000", 10);

if (!Number.isFinite(count) || count <= 0) {
  process.stderr.write(`Invalid count: ${process.argv[3]}\n`);
  process.exitCode = 1;
} else {
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const mnemonic = generateOneValidMnemonicWithFixedPrefix();
    lines.push(mnemonic);
  }

  fs.writeFileSync(outputFile, lines.join("\n") + "\n", "utf-8");
  process.stdout.write(`Generated ${count} valid mnemonics (prefix: "${KNOWN_WORDS[0]}...${KNOWN_WORDS[KNOWN_WORDS.length - 1]}") and saved to ${outputFile}\n`);

  // Verify first line
  const first = lines[0];
  const words = first.split(" ");
  const prefixOk = KNOWN_WORDS.every((w, i) => words[i] === w);
  if (!prefixOk) {
    process.stderr.write(`ERROR: First mnemonic prefix mismatch!\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Prefix verification: PASSED\n`);
  }
}
