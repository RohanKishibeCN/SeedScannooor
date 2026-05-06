import aiohttp
import asyncio
import logging
from cachetools import TTLCache
from typing import Any

logger = logging.getLogger(__name__)

COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
COINGECKO_PARAMS = {
    "ids": "ethereum,binancecoin,solana,tether,usd-coin",
    "vs_currencies": "usd",
}
TOKEN_ID_MAP = {
    "ETH": "ethereum",
    "BNB": "binancecoin",
    "SOL": "solana",
    "USDT": "tether",
    "USDC": "usd-coin",
}
PRICE_CACHE = TTLCache(maxsize=10, ttl=300)
DEFAULT_PRICES: dict[str, float] = {
    "ethereum": 0.0,
    "binancecoin": 0.0,
    "solana": 0.0,
    "tether": 1.0,
    "usd-coin": 1.0,
}
CHAIN_PRICE_KEY: dict[str, str] = {
    "ethereum": "ethereum",
    "bsc": "binancecoin",
    "polygon": "ethereum",
    "arbitrum": "ethereum",
    "base": "ethereum",
}


async def get_prices() -> dict[str, float]:
    """
    获取各资产美元价格。
    返回: {"ethereum": 3500.0, "binancecoin": 600.0, "solana": 150.0, "tether": 1.0, "usd-coin": 1.0}
    缓存 5 分钟。
    """
    cache_key = "prices"
    if cache_key in PRICE_CACHE:
        return PRICE_CACHE[cache_key]

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(COINGECKO_URL, params=COINGECKO_PARAMS, timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status == 200:
                    data: dict[str, Any] = await response.json()
                    result = {
                        "ethereum": data.get("ethereum", {}).get("usd", 0.0),
                        "binancecoin": data.get("binancecoin", {}).get("usd", 0.0),
                        "solana": data.get("solana", {}).get("usd", 0.0),
                        "tether": data.get("tether", {}).get("usd", 1.0),
                        "usd-coin": data.get("usd-coin", {}).get("usd", 1.0),
                    }
                    PRICE_CACHE[cache_key] = result
                    logger.info("成功获取价格数据: %s", result)
                    return result
                else:
                    logger.warning("Coingecko API 返回错误状态码: %d", response.status)
    except Exception as e:
        logger.error("获取价格失败: %s", str(e))

    logger.info("使用默认价格数据")
    return DEFAULT_PRICES.copy()


def calculate_total_usd(
    addresses: list[dict],
    chain: str,
    prices: dict[str, float],
) -> float:
    """
    计算一条助记词所有地址的资产总 USD 估值。

    Args:
        addresses: Moralis 格式的地址列表，每项包含:
            - native_balance: 原生币余额（ETH/BNB/MATIC，已转单位）
            - usdt: USDT 余额
            - usdc: USDC 余额
        chain: 链名，支持 ethereum/bsc/polygon/arbitrum/base
        prices: 代币美元价格 dict

    Returns:
        总 USD 估值

    Example:
        addresses = [
            {"native_balance": 1.5, "usdt": 100.0, "usdc": 50.0},
            {"native_balance": 0.5, "usdt": 200.0, "usdc": 0.0},
        ]
        calculate_total_usd(addresses, "ethereum", prices)
    """
    native_price_key = CHAIN_PRICE_KEY.get(chain, "ethereum")
    native_price = prices.get(native_price_key, 0.0)
    tether_price = prices.get("tether", 1.0)
    usd_coin_price = prices.get("usd-coin", 1.0)

    total = 0.0
    for addr_info in addresses:
        native_balance = addr_info.get("native_balance", 0.0)
        usdt = addr_info.get("usdt", 0.0)
        usdc = addr_info.get("usdc", 0.0)

        total += native_balance * native_price
        total += usdt * tether_price
        total += usdc * usd_coin_price

    return total


def should_keep(total_usd: float, threshold: float = 10.0) -> bool:
    """判断总估值是否超过阈值"""
    return total_usd >= threshold
