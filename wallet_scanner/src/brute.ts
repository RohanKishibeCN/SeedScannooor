import { randomBytes } from "node:crypto";
import bip39 from "bip39";

/**
 * 暴力破解前缀：前 8 个已知助记词（用户给定，不可修改）
 */
export const KNOWN_WORDS = [
  "fault",
  "door",
  "pride",
  "design",
  "claw",
  "naive",
  "raccoon",
  "price",
] as const;

/**
 * 启动时校验已知词全部存在于 BIP39 英文词表。
 * 若某个词拼写错误，indexOf 返回 -1 会导致整条助记词前缀错误，
 * 每天的 API 调用会全部浪费在错误的词上 —— 这里直接抛错阻止。
 */
const validateKnownWords = (): void => {
  for (const word of KNOWN_WORDS) {
    if (bip39.wordlists.english.indexOf(word) === -1) {
      throw new Error(
        `KNOWN_WORDS contains a word not in the BIP39 English wordlist: "${word}"`
      );
    }
  }
};

validateKnownWords();

/**
 * 生成一条前 8 个词固定、后 4 个词随机的合法 BIP39 助记词。
 *
 * 原理：
 *  - 8 个已知词 = 88 bits 熵 → 写入 entropy[0..10]（11 字节）
 *  - 剩余 5 字节随机熵 → entropy[11..15]，共 128 bits
 *  - 由 bip39.entropyToMnemonic 计算 checksum 补全第 12 个词，
 *    保证输出永远合法（BIP39 checksum 一致）
 *  - 抽样空间 = 2^40 条合法助记词，均匀覆盖"前缀固定"的合法空间
 */
export const generateBruteMnemonic = (): string => {
  const entropy = Buffer.alloc(16);

  let combined = 0n;
  for (const word of KNOWN_WORDS) {
    const idx = bip39.wordlists.english.indexOf(word);
    combined = (combined << 11n) | BigInt(idx);
  }

  for (let i = 0; i < 11; i += 1) {
    const shift = BigInt((10 - i) * 8);
    entropy[i] = Number((combined >> shift) & 0xffn);
  }

  randomBytes(5).copy(entropy, 11);

  return bip39.entropyToMnemonic(entropy);
};
