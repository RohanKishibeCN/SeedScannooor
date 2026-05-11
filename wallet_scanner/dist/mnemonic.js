import fs from "node:fs";
import bip39 from "bip39";
import { HDNodeWallet } from "ethers";
import { derivePath } from "ed25519-hd-key";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
const EVM_CHAINS = [
    "ethereum",
    "bsc",
    "polygon",
    "arbitrum",
    "base"
];
const deriveEvmAddresses = (mnemonic, depth) => {
    const root = HDNodeWallet.fromPhrase(mnemonic, undefined, "m");
    const out = {};
    for (const chain of EVM_CHAINS) {
        const addresses = [];
        for (let i = 0; i < depth; i += 1) {
            const child = root.derivePath(`m/44'/60'/0'/0/${i}`);
            addresses.push(child.address);
        }
        out[chain] = addresses;
    }
    return out;
};
const deriveSolanaAddresses = (mnemonic, depth) => {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const addresses = [];
    for (let i = 0; i < depth; i += 1) {
        const { key } = derivePath(`m/44'/501'/0'/0'/${i}'`, seed.toString("hex"));
        const keyPair = nacl.sign.keyPair.fromSeed(key);
        const pub = new PublicKey(keyPair.publicKey);
        addresses.push(pub.toBase58());
    }
    return addresses;
};
export const deriveAddresses = (mnemonic, depth = 20) => {
    if (!bip39.validateMnemonic(mnemonic)) {
        return {
            ethereum: [],
            bsc: [],
            polygon: [],
            arbitrum: [],
            base: [],
            solana: []
        };
    }
    const evm = deriveEvmAddresses(mnemonic, depth);
    const sol = deriveSolanaAddresses(mnemonic, depth);
    return {
        ethereum: evm.ethereum ?? [],
        bsc: evm.bsc ?? [],
        polygon: evm.polygon ?? [],
        arbitrum: evm.arbitrum ?? [],
        base: evm.base ?? [],
        solana: sol
    };
};
export const loadMnemonics = (filePath) => {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split(/\r?\n/);
        const mnemonics = [];
        for (let i = 0; i < lines.length; i += 1) {
            const m = lines[i]?.trim();
            if (m) {
                mnemonics.push([i + 1, m]);
            }
        }
        return mnemonics;
    }
    catch {
        return [];
    }
};
