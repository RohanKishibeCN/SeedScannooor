import aiohttp
import asyncio
import logging
from typing import Optional
from web3 import Web3

logger = logging.getLogger(__name__)

MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"

MULTICALL3_ABI = [
    {
        "inputs": [
            {
                "components": [
                    {"name": "target", "type": "address"},
                    {"name": "callData", "type": "bytes"},
                ],
                "name": "calls",
                "type": "tuple[]",
            }
        ],
        "name": "aggregate3Value",
        "outputs": [
            {
                "components": [
                    {"name": "success", "type": "bool"},
                    {"name": "returnData", "type": "bytes"},
                    {"name": "gasUsed", "type": "uint256"},
                ],
                "name": "returnData",
                "type": "tuple[]",
            }
        ],
        "stateMutability": "payable",
        "type": "function",
    }
]

ERC20_BALANCE_OF_ABI = {
    "inputs": [{"name": "account", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function",
}

DECIMALS_ABI = {
    "inputs": [],
    "name": "decimals",
    "outputs": [{"name": "", "type": "uint8"}],
    "stateMutability": "view",
    "type": "function",
}

DEFAULT_TOKEN_CONTRACTS = {
    "Ethereum": {
        "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
    "BSC": {
        "USDT": "0x55d398326f99059fF775485246999027B3197955",
        "USDC": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580",
    },
    "Polygon": {
        "USDT": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "USDC": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    },
    "Arbitrum": {
        "USDT": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        "USDC": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    },
    "Base": {
        "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
        "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
}


def encode_balance_of_call(address: str) -> bytes:
    web3 = Web3()
    return web3.codec.encode_function_call(ERC20_BALANCE_OF_ABI, [address])


async def get_native_balance(rpc_url: str, address: str) -> Optional[float]:
    payload = {
        "jsonrpc": "2.0",
        "method": "eth_getBalance",
        "params": [address, "latest"],
        "id": 1,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(rpc_url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    logger.error(f"RPC request failed with status {resp.status}: {rpc_url}")
                    return None
                result = await resp.json()
                if "result" in result:
                    wei_balance = int(result["result"], 16)
                    eth_balance = wei_balance / (10 ** 18)
                    return round(eth_balance, 8)
                else:
                    error = result.get("error", "Unknown error")
                    logger.error(f"RPC error for {address}: {error}")
                    return None
    except Exception as e:
        logger.error(f"Failed to get native balance for {address}: {e}")
        return None


async def get_erc20_balances(
    rpc_url: str,
    address: str,
    token_contracts: dict[str, str],
) -> dict[str, float]:
    if not token_contracts:
        return {}

    web3 = Web3()
    codec = web3.codec

    calls = []
    token_symbols = []
    for symbol, contract_addr in token_contracts.items():
        checksum_addr = Web3.to_checksum_address(contract_addr)
        call_data = codec.encode_function_call(ERC20_BALANCE_OF_ABI, [address])
        calls.append({"target": checksum_addr, "callData": call_data})
        token_symbols.append(symbol)

    aggregate_data = codec.encode_function_call(
        {
            "inputs": [
                {
                    "components": [
                        {"name": "target", "type": "address"},
                        {"name": "callData", "type": "bytes"},
                    ],
                    "name": "calls",
                    "type": "tuple[]",
                }
            ],
            "name": "aggregate3Value",
            "outputs": [
                {
                    "components": [
                        {"name": "success", "type": "bool"},
                        {"name": "returnData", "type": "bytes"},
                        {"name": "gasUsed", "type": "uint256"},
                    ],
                    "name": "returnData",
                    "type": "tuple[]",
                }
            ],
            "stateMutability": "payable",
            "type": "function",
        },
        [calls],
    )

    payload = {
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [
            {
                "to": MULTICALL3_ADDRESS,
                "data": aggregate_data,
            },
            "latest",
        ],
        "id": 1,
    }

    balances = {}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(rpc_url, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                if resp.status != 200:
                    logger.error(f"Multicall RPC request failed with status {resp.status}: {rpc_url}")
                    return {symbol: 0.0 for symbol in token_symbols}
                result = await resp.json()
                if "result" in result and result["result"] != "0x":
                    return_data = codec.decode_function_output(
                        {
                            "inputs": [
                                {
                                    "components": [
                                        {"name": "success", "type": "bool"},
                                        {"name": "returnData", "type": "bytes"},
                                        {"name": "gasUsed", "type": "uint256"},
                                    ],
                                    "name": "returnData",
                                    "type": "tuple[]",
                                }
                            ],
                            "name": "aggregate3Value",
                            "outputs": [
                                {
                                    "components": [
                                        {"name": "success", "type": "bool"},
                                        {"name": "returnData", "type": "bytes"},
                                        {"name": "gasUsed", "type": "uint256"},
                                    ],
                                    "name": "returnData",
                                    "type": "tuple[]",
                                }
                            ],
                            "stateMutability": "payable",
                            "type": "function",
                        },
                        result["result"],
                    )
                    for i, (symbol, success_data) in enumerate(zip(token_symbols, return_data[0])):
                        if success_data[0]:
                            balance = int.from_bytes(success_data[1], "big")
                            balances[symbol] = balance / (10 ** 6)
                        else:
                            balances[symbol] = 0.0
                else:
                    balances = {symbol: 0.0 for symbol in token_symbols}
    except Exception as e:
        logger.error(f"Failed to get ERC20 balances for {address}: {e}")
        balances = {symbol: 0.0 for symbol in token_symbols}

    for symbol in token_symbols:
        if symbol not in balances:
            balances[symbol] = 0.0

    return balances


async def _scan_single_address(
    rpc_url: str,
    address: str,
    token_contracts: dict[str, str],
    semaphore: asyncio.Semaphore,
    interval_ms: int,
) -> dict:
    async with semaphore:
        result = {
            "address": address,
            "native_balance": None,
            "usdt": 0.0,
            "usdc": 0.0,
        }

        try:
            native_balance = await get_native_balance(rpc_url, address)
            result["native_balance"] = native_balance
        except Exception as e:
            logger.error(f"Error getting native balance for {address}: {e}")
            result["native_balance"] = None

        try:
            erc20_balances = await get_erc20_balances(rpc_url, address, token_contracts)
            result["usdt"] = erc20_balances.get("USDT", 0.0)
            result["usdc"] = erc20_balances.get("USDC", 0.0)
        except Exception as e:
            logger.error(f"Error getting ERC20 balances for {address}: {e}")

        if interval_ms > 0:
            await asyncio.sleep(interval_ms / 1000.0)

        return result


async def scan_evm_addresses(
    rpc_url: str,
    addresses: list[str],
    token_contracts: dict[str, str],
    max_concurrent: int = 5,
    interval_ms: int = 100,
) -> list[dict]:
    semaphore = asyncio.Semaphore(max_concurrent)

    tasks = [
        _scan_single_address(rpc_url, addr, token_contracts, semaphore, interval_ms)
        for addr in addresses
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    final_results = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.error(f"Task failed for address {addresses[i]}: {result}")
            final_results.append({
                "address": addresses[i],
                "native_balance": None,
                "usdt": 0.0,
                "usdc": 0.0,
            })
        else:
            final_results.append(result)

    return final_results


def get_chain_token_contracts(chain_name: str) -> dict[str, str]:
    return DEFAULT_TOKEN_CONTRACTS.get(chain_name, {})
