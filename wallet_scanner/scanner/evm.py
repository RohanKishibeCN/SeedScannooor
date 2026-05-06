import aiohttp
import asyncio
import logging

logger = logging.getLogger(__name__)

MORALIS_BASE_URL = "https://deep-index.moralis.io/api/v2.2"


def get_chain_moralis_chain_id(chain: str) -> str:
    chain_mapping = {
        "eth": "eth",
        "bsc": "bsc",
        "polygon": "polygon",
        "arbitrum": "arbitrum",
        "base": "base",
    }
    return chain_mapping.get(chain.lower(), "eth")


async def get_address_balances(
    api_key: str,
    address: str,
    chain: str,
) -> dict:
    chain_id = get_chain_moralis_chain_id(chain)
    url = f"{MORALIS_BASE_URL}/{address}"

    headers = {
        "X-API-Key": api_key,
        "accept": "application/json",
    }

    params = {
        "chain": chain_id,
        "exclude_spam": "true",
    }

    result = {
        "address": address,
        "native_balance": 0.0,
        "usdt": 0.0,
        "usdc": 0.0,
        "raw_tokens": [],
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    logger.error(f"Moralis API request failed with status {resp.status} for {address}")
                    return result

                data = await resp.json()

                if "native_balance" in data and data["native_balance"]:
                    try:
                        wei_balance = int(data["native_balance"].get("balance", "0"))
                        result["native_balance"] = round(wei_balance / (10**18), 8)
                    except (ValueError, TypeError) as e:
                        logger.warning(f"Failed to parse native balance for {address}: {e}")

                if "tokens" in data and data["tokens"]:
                    result["raw_tokens"] = data["tokens"]

                    for token in data["tokens"]:
                        symbol = token.get("symbol", "").upper()
                        if symbol in ("USDT", "USDC"):
                            try:
                                decimals = int(token.get("decimals", 6))
                                if "balance_formatted" in token:
                                    balance = float(token["balance_formatted"])
                                else:
                                    raw_balance = int(token.get("balance", "0"))
                                    balance = raw_balance / (10**decimals)

                                key = symbol.lower()
                                result[key] = round(balance, 8)
                            except (ValueError, TypeError) as e:
                                logger.warning(f"Failed to parse token balance for {symbol} at {address}: {e}")

    except asyncio.TimeoutError:
        logger.error(f"Moralis API timeout for {address}")
    except aiohttp.ClientError as e:
        logger.error(f"Moralis API client error for {address}: {e}")
    except Exception as e:
        logger.error(f"Unexpected error getting balances for {address}: {e}")

    return result


async def _scan_single_address(
    api_key: str,
    address: str,
    chain: str,
    semaphore: asyncio.Semaphore,
    interval_ms: int,
) -> dict:
    async with semaphore:
        result = await get_address_balances(api_key, address, chain)

        if interval_ms > 0:
            await asyncio.sleep(interval_ms / 1000.0)

        return result


async def scan_evm_addresses(
    api_key: str,
    addresses: list[str],
    chain: str,
    max_concurrent: int = 5,
    interval_ms: int = 100,
) -> list[dict]:
    semaphore = asyncio.Semaphore(max_concurrent)

    tasks = [
        _scan_single_address(api_key, addr, chain, semaphore, interval_ms)
        for addr in addresses
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    final_results = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.error(f"Task failed for address {addresses[i]}: {result}")
            final_results.append({
                "address": addresses[i],
                "native_balance": 0.0,
                "usdt": 0.0,
                "usdc": 0.0,
                "raw_tokens": [],
            })
        else:
            final_results.append(result)

    return final_results
