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
    prices: dict[str, float],
) -> float:
    """
    计算一条助记词所有地址的资产总 USD 估值。
    包含：ETH + BNB + SOL + USDT + USDC（各自 × 对应价格）
    """
    total = 0.0
    for addr_info in addresses:
        eth = addr_info.get("eth", {})
        sol = addr_info.get("sol", {})

        total += eth.get("ETH", 0.0) * prices.get("ethereum", 0.0)
        total += eth.get("BNB", 0.0) * prices.get("binancecoin", 0.0)
        total += sol.get("SOL", 0.0) * prices.get("solana", 0.0)
        total += eth.get("USDT", 0.0) * prices.get("tether", 1.0)
        total += eth.get("USDC", 0.0) * prices.get("usd-coin", 1.0)
        total += sol.get("USDT", 0.0) * prices.get("tether", 1.0)
        total += sol.get("USDC", 0.0) * prices.get("usd-coin", 1.0)

    return total


def should_keep(total_usd: float, threshold: float = 10.0) -> bool:
    """判断总估值是否超过阈值"""
    return total_usd >= threshold
