import aiohttp
import asyncio
import logging

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

LAMPORTS_PER_SOL = 1_000_000_000


async def get_sol_balance(rpc_url: str, address: str) -> float:
    """获取 SOL 余额（保留 8 位小数）"""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getBalance",
        "params": [address],
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(rpc_url, json=payload) as response:
                if response.status != 200:
                    logger.warning(f"getBalance request failed for {address}: HTTP {response.status}")
                    return 0.0

                data = await response.json()

                if "error" in data:
                    logger.warning(f"getBalance error for {address}: {data['error']}")
                    return 0.0

                lamports = data.get("result", {}).get("value", 0)
                sol_balance = lamports / LAMPORTS_PER_SOL
                return round(sol_balance, 8)

    except aiohttp.ClientError as e:
        logger.warning(f"Network error getting SOL balance for {address}: {e}")
        return 0.0
    except Exception as e:
        logger.warning(f"Unexpected error getting SOL balance for {address}: {e}")
        return 0.0


async def get_spl_balances(
    rpc_url: str,
    address: str,
    mint_addresses: dict[str, str],
) -> dict[str, float]:
    """查询 SPL 代币余额。返回: {"USDT": 50.0, "USDC": 100.0}（空缺为 0.0）"""
    result = {symbol: 0.0 for symbol in mint_addresses.keys()}

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTokenAccountsByOwner",
        "params": [
            address,
            {"mint": None},
            {"encoding": "jsonParsed"},
        ],
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(rpc_url, json=payload) as response:
                if response.status != 200:
                    logger.warning(f"getTokenAccountsByOwner request failed for {address}: HTTP {response.status}")
                    return result

                data = await response.json()

                if "error" in data:
                    logger.warning(f"getTokenAccountsByOwner error for {address}: {data['error']}")
                    return result

                accounts = data.get("result", {}).get("value", [])

                mint_to_symbol: dict[str, str] = {v: k for k, v in mint_addresses.items()}

                for account in accounts:
                    try:
                        parsed = account.get("account", {}).get("data", {}).get("parsed", {})
                        info = parsed.get("info", {})
                        mint = info.get("mint", "")
                        amount = info.get("tokenAmount", {}).get("uiAmount", 0.0)

                        if mint in mint_to_symbol:
                            symbol = mint_to_symbol[mint]
                            result[symbol] = amount

                    except (KeyError, TypeError) as e:
                        logger.warning(f"Failed to parse SPL account for {address}: {e}")
                        continue

    except aiohttp.ClientError as e:
        logger.warning(f"Network error getting SPL balances for {address}: {e}")
        return result
    except Exception as e:
        logger.warning(f"Unexpected error getting SPL balances for {address}: {e}")
        return result

    return result


async def scan_address(
    rpc_url: str,
    address: str,
    mint_addresses: dict[str, str],
    semaphore: asyncio.Semaphore,
    interval_ms: int,
) -> dict:
    """扫描单个 Solana 地址（带并发控制和限流）"""
    async with semaphore:
        sol_balance = await get_sol_balance(rpc_url, address)
        spl_balances = await get_spl_balances(rpc_url, address, mint_addresses)

        await asyncio.sleep(interval_ms / 1000.0)

        result = {
            "address": address,
            "sol": sol_balance,
        }
        result.update(spl_balances)
        return result


async def scan_solana_addresses(
    rpc_url: str,
    addresses: list[str],
    mint_addresses: dict[str, str],
    max_concurrent: int = 5,
    interval_ms: int = 100,
) -> list[dict]:
    """扫描一批 Solana 地址。返回格式: [{"address": "...", "sol": 5.0, "usdt": 0.0, "usdc": 10.0}, ...]"""
    semaphore = asyncio.Semaphore(max_concurrent)

    tasks = [
        scan_address(rpc_url, address, mint_addresses, semaphore, interval_ms)
        for address in addresses
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    scanned_results: list[dict] = []
    for i, res in enumerate(results):
        if isinstance(res, Exception):
            logger.warning(f"Failed to scan address {addresses[i]}: {res}")
            scanned_results.append({
                "address": addresses[i],
                "sol": 0.0,
                **{symbol: 0.0 for symbol in mint_addresses.keys()},
            })
        else:
            scanned_results.append(res)

    return scanned_results
