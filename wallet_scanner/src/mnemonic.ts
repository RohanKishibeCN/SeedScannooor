import fs from "node:fs";
import bip39 from "bip39";
import { HDNodeWallet } from "ethers";
import { derivePath } from "ed25519-hd-key";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import type { Chain } from "./types.js";

const EVM_CHAINS: Exclude<Chain, "solana">[] = [
  "ethereum",
  "bsc",
  "polygon",
  "arbitrum",
  "base"
];

const deriveEvmAddresses = (mnemonic: string, chains: Chain[], depth: number): Record<string, string[]> => {
  const evmChains = chains.filter((c) => c !== "solana");
  if (evmChains.length === 0) return {};

  const root = HDNodeWallet.fromPhrase(mnemonic, undefined, "m");
  const out: Record<string, string[]> = {};

  for (const chain of evmChains) {
    const addresses: string[] = [];
    for (let i = 0; i < depth; i += 1) {
      const child = root.derivePath(`m/44'/60'/0'/0/${i}`);
      addresses.push(child.address);
    }
    out[chain] = addresses;
  }

  return out;
};

const deriveSolanaAddresses = (mnemonic: string, depth: number): string[] => {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const addresses: string[] = [];

  for (let i = 0; i < depth; i += 1) {
    const { key } = derivePath(`m/44'/501'/0'/0'/${i}'`, seed.toString("hex"));
    const keyPair = nacl.sign.keyPair.fromSeed(key);
    const pub = new PublicKey(keyPair.publicKey);
    addresses.push(pub.toBase58());
  }

  return addresses;
};

export const deriveAddresses = (
  mnemonic: string,
  chains: Chain[],
  depth = 5
): Record<Chain, string[]> => {
  if (!bip39.validateMnemonic(mnemonic)) {
    const empty: Record<string, string[]> = {};
    for (const c of chains) {
      empty[c] = [];
    }
    return empty as Record<Chain, string[]>;
  }

  const out: Record<string, string[]> = {};

  const solanaEnabled = chains.includes("solana");
  const evmEnabled = chains.filter((c) => c !== "solana");

  if (evmEnabled.length > 0) {
    const evm = deriveEvmAddresses(mnemonic, chains, depth);
    for (const [chain, addrs] of Object.entries(evm)) {
      out[chain] = addrs;
    }
  }

  if (solanaEnabled) {
    out.solana = deriveSolanaAddresses(mnemonic, depth);
  }

  for (const c of chains) {
    if (!out[c]) out[c] = [];
  }

  return out as Record<Chain, string[]>;
};

export const loadMnemonics = (filePath: string): Array<[number, string]> => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const mnemonics: Array<[number, string]> = [];

    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i]?.trim();
      if (m) {
        mnemonics.push([i + 1, m]);
      }
    }

    return mnemonics;
  } catch {
    return [];
  }
};
