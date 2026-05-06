import logging

from bip_utils import (
    Bip39SeedGenerator,
    Bip44,
    Bip44Coins,
    Bip44Changes,
    Bip32Slip10Ed25519,
    SolAddr,
)

logger = logging.getLogger(__name__)

CHAIN_EVM = "evm"
CHAIN_SOLANA = "solana"

EVM_COIN_TYPES = {
    "ethereum": Bip44Coins.ETHEREUM,
    "bsc": Bip44Coins.BINANCE_SMART_CHAIN,
    "polygon": Bip44Coins.POLYGON,
    "arbitrum": Bip44Coins.ARBITRUM,
    "base": Bip44Coins.ETHEREUM,
}

SOLANA_COIN = Bip44Coins.SOLANA


def _is_valid_mnemonic(mnemonic: str) -> bool:
    try:
        Bip39SeedGenerator(mnemonic).Generate()
        return True
    except Exception:
        return False


def derive_addresses(mnemonic: str, depth: int = 20) -> dict[str, list[str]]:
    """
    给定助记词，返回所有链的派生地址。
    返回格式: {
        "ethereum": ["0x...", "0x...", ...],
        "bsc": [...],
        "polygon": [...],
        "arbitrum": [...],
        "base": [...],
        "solana": [...],
    }
    """
    if not _is_valid_mnemonic(mnemonic):
        logger.warning("无效的助记词，跳过派生")
        return {
            "ethereum": [], "bsc": [], "polygon": [], "arbitrum": [], "base": [], "solana": []
        }

    result: dict[str, list[str]] = {}

    for chain_name, coin_type in EVM_COIN_TYPES.items():
        try:
            seed = Bip39SeedGenerator(mnemonic).Generate()
            addresses = []
            for i in range(depth):
                bip44_mst = Bip44.FromSeed(seed, coin_type)
                bip44_acc = bip44_mst.Purpose().Coin().Account(0).Change(Bip44Changes.CHAIN_EXT).AddressIndex(i)
                addresses.append(bip44_acc.PublicKey().ToAddress())
            result[chain_name] = addresses
            del seed
        except Exception:
            result[chain_name] = []

    try:
        seed = Bip39SeedGenerator(mnemonic).Generate()
        bip32_ctx = Bip32Slip10Ed25519.FromSeed(seed)
        solana_addresses = []
        for i in range(depth):
            derived = (
                bip32_ctx.ChildKey(0x80000000 | 44)
                .ChildKey(0x80000000 | 501)
                .ChildKey(0x80000000 | 0)
                .ChildKey(0x80000000 | 0)
                .ChildKey(0x80000000 | i)
            )
            solana_addresses.append(SolAddr.EncodeKey(derived.PublicKey().RawCompressed().ToBytes()))
        result["solana"] = solana_addresses
        del seed
    except Exception:
        result["solana"] = []

    return result


def load_mnemonics(file_path: str) -> list[tuple[int, str]]:
    """
    从文件加载所有助记词，每行一条。
    返回: [(行号从1开始, 助记词字符串), ...]
    """
    mnemonics: list[tuple[int, str]] = []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, start=1):
                mnemonic = line.strip()
                if mnemonic:
                    mnemonics.append((line_num, mnemonic))
    except FileNotFoundError:
        logger.warning(f"文件未找到: {file_path}")
    except Exception as e:
        logger.warning(f"读取文件失败: {file_path}, 错误: {e}")
    return mnemonics
