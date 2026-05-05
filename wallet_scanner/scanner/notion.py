import asyncio
import json
from datetime import datetime, timezone
from typing import Any

import aiohttp
from notion_client import AsyncClient


async def validate_database(notion: AsyncClient, database_id: str) -> bool:
    try:
        await notion.databases.query(database_id, page_size=1)
        return True
    except Exception:
        return False


async def write_to_notion(
    notion_api_key: str,
    database_id: str,
    page_data: dict,
) -> bool:
    """
    向 Notion 数据库写入一条记录。
    page_data 格式:
    {
        "mnemonic_index": 1,
        "chain": "ethereum",
        "address": "0x...",
        "native_balance": 1.5,
        "usdt": 100.0,
        "usdc": 50.0,
        "total_usd": 2500.0,
        "snapshot_time": "2025-01-01T12:00:00Z",
    }
    返回: 成功 True，失败 False
    """
    notion = AsyncClient(auth=notion_api_key)

    try:
        is_valid = await validate_database(notion, database_id)
        if not is_valid:
            raise ValueError(f"Invalid database_id: {database_id}")
    except ValueError:
        raise
    except Exception:
        return False

    mnemonic_index = page_data.get("mnemonic_index", 0)
    address = page_data.get("address", "")
    chain = page_data.get("chain", "")
    native_balance = page_data.get("native_balance", 0.0)
    usdt = page_data.get("usdt", 0.0)
    usdc = page_data.get("usdc", 0.0)
    total_usd = page_data.get("total_usd", 0.0)
    snapshot_time = page_data.get("snapshot_time", "")

    properties: dict[str, Any] = {
        "MnemonicIndex": {"number": mnemonic_index},
        "WalletAddress": {"title": [{"text": {"content": address}}]},
        "Chain": {"select": {"name": chain}},
        "CoinBalance": {"number": round(native_balance, 8)},
        "USDTBalance": {"number": usdt},
        "USDCBalance": {"number": usdc},
        "TotalUSDValue": {"number": round(total_usd, 2)},
        "SnapshotTime": {"date": {"start": snapshot_time}},
        "Status": {"select": {"name": "Passed"}},
    }

    try:
        await notion.pages.create(
            parent={"database_id": database_id},
            properties=properties,
        )
        return True
    except Exception:
        return False


async def _write_single_page(
    semaphore: asyncio.Semaphore,
    session: aiohttp.ClientSession,
    notion_api_key: str,
    database_id: str,
    page_data: dict,
    index: int,
) -> tuple[int, dict, str | None]:
    async with semaphore:
        url = "https://api.notion.com/v1/pages"
        headers = {
            "Authorization": f"Bearer {notion_api_key}",
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
        }

        mnemonic_index = page_data.get("mnemonic_index", 0)
        address = page_data.get("address", "")
        chain = page_data.get("chain", "")
        native_balance = page_data.get("native_balance", 0.0)
        usdt = page_data.get("usdt", 0.0)
        usdc = page_data.get("usdc", 0.0)
        total_usd = page_data.get("total_usd", 0.0)
        snapshot_time = page_data.get("snapshot_time", "")

        properties: dict[str, Any] = {
            "MnemonicIndex": {"number": mnemonic_index},
            "WalletAddress": {"title": [{"text": {"content": address}}]},
            "Chain": {"select": {"name": chain}},
            "CoinBalance": {"number": round(native_balance, 8)},
            "USDTBalance": {"number": usdt},
            "USDCBalance": {"number": usdc},
            "TotalUSDValue": {"number": round(total_usd, 2)},
            "SnapshotTime": {"date": {"start": snapshot_time}},
            "Status": {"select": {"name": "Passed"}},
        }

        payload = {
            "parent": {"database_id": database_id},
            "properties": properties,
        }

        try:
            async with session.post(url, headers=headers, json=payload) as response:
                if response.status in (200, 201):
                    return (index, page_data, None)
                else:
                    error_text = await response.text()
                    return (index, page_data, f"HTTP {response.status}: {error_text}")
        except Exception as e:
            return (index, page_data, str(e))


async def batch_write_to_notion(
    notion_api_key: str,
    database_id: str,
    pages: list[dict],
    failed_log_path: str = "failed_notion_writes.jsonl",
    max_concurrent: int = 10,
) -> tuple[int, int]:
    """
    批量写入 Notion，失败条目写入 failed_notion_writes.jsonl。
    返回: (成功数, 失败数)
    """
    if not pages:
        return (0, 0)

    notion = AsyncClient(auth=notion_api_key)

    try:
        is_valid = await validate_database(notion, database_id)
        if not is_valid:
            raise ValueError(f"Invalid database_id: {database_id}")
    except ValueError:
        raise
    except Exception:
        return (0, len(pages))

    semaphore = asyncio.Semaphore(max_concurrent)

    timeout = aiohttp.ClientTimeout(total=60)
    connector = aiohttp.TCPConnector(limit=max_concurrent)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        tasks = [
            _write_single_page(
                semaphore,
                session,
                notion_api_key,
                database_id,
                page,
                idx,
            )
            for idx, page in enumerate(pages)
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

    success_count = 0
    failed_count = 0
    failed_entries: list[dict] = []
    timestamp = datetime.now(timezone.utc).isoformat()

    for result in results:
        if isinstance(result, Exception):
            failed_entries.append({
                "timestamp": timestamp,
                "page_data": {},
                "error": str(result),
            })
            failed_count += 1
            continue

        index, page_data, error = result
        if error is None:
            success_count += 1
        else:
            failed_entries.append({
                "timestamp": timestamp,
                "page_data": page_data,
                "error": error,
            })
            failed_count += 1

    if failed_entries:
        with open(failed_log_path, "a", encoding="utf-8") as f:
            for entry in failed_entries:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return (success_count, failed_count)
