import csv
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def get_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def format_filename() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def aggregate_results(
    all_addresses: dict[str, list[dict]],
    mnemonic_index: int,
    snapshot_time: str,
) -> dict:
    addresses: list[dict] = []
    total_usd_value = 0.0

    for chain, results in all_addresses.items():
        for addr_result in results:
            address = addr_result.get("address", "")

            if chain.lower() == "solana":
                addr_entry = {
                    "chain": chain.lower(),
                    "address": address,
                    "sol_balance": addr_result.get("sol", 0.0),
                    "usdt": addr_result.get("usdt", 0.0),
                    "usdc": addr_result.get("usdc", 0.0),
                    "total_usd_value": 0.0,
                }
            else:
                native_balance = addr_result.get("native_balance", 0.0) or 0.0
                addr_entry = {
                    "chain": chain.lower(),
                    "address": address,
                    "native_balance": native_balance,
                    "usdt": addr_result.get("usdt", 0.0),
                    "usdc": addr_result.get("usdc", 0.0),
                    "total_usd_value": 0.0,
                }

            addresses.append(addr_entry)

    return {
        "mnemonic_index": mnemonic_index,
        "addresses": addresses,
        "total_usd_value": total_usd_value,
        "snapshot_time": snapshot_time,
    }


def write_json_output(
    output_dir: str,
    results: list[dict],
    threshold_usd: float,
    scan_time: Optional[str] = None,
) -> str:
    if scan_time is None:
        scan_time = get_timestamp()

    os.makedirs(output_dir, exist_ok=True)

    timestamp_str = format_filename()
    filename = f"{timestamp_str}_scan_results.json"
    filepath = os.path.join(output_dir, filename)

    total_scanned = len(results)
    passed = sum(1 for r in results if r.get("total_usd_value", 0.0) >= threshold_usd)

    output = {
        "scan_time": scan_time,
        "threshold_usd": threshold_usd,
        "total_scanned": total_scanned,
        "passed": passed,
        "results": results,
    }

    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        logger.info(f"JSON output written to {filepath}")
    except Exception as e:
        logger.error(f"Failed to write JSON output: {e}")
        raise

    return filepath


def write_csv_output(
    output_dir: str,
    results: list[dict],
    scan_time: Optional[str] = None,
) -> str:
    if scan_time is None:
        scan_time = get_timestamp()

    os.makedirs(output_dir, exist_ok=True)

    timestamp_str = format_filename()
    filename = f"{timestamp_str}_scan_results.csv"
    filepath = os.path.join(output_dir, filename)

    rows = []
    for result in results:
        mnemonic_index = result.get("mnemonic_index")
        snapshot_time = result.get("snapshot_time", scan_time)
        addresses = result.get("addresses", [])

        for addr in addresses:
            chain = addr.get("chain", "")
            native_bal = addr.get("native_balance") if chain != "solana" else addr.get("sol_balance", 0.0)
            row = {
                "mnemonic_index": mnemonic_index,
                "chain": chain,
                "address": addr.get("address", ""),
                "native_balance": native_bal,
                "usdt_balance": addr.get("usdt", 0.0),
                "usdc_balance": addr.get("usdc", 0.0),
                "total_usd_value": addr.get("total_usd_value", 0.0),
                "snapshot_time": snapshot_time,
            }
            rows.append(row)

    try:
        with open(filepath, "w", encoding="utf-8", newline="") as f:
            if rows:
                writer = csv.DictWriter(
                    f,
                    fieldnames=[
                        "mnemonic_index",
                        "chain",
                        "address",
                        "native_balance",
                        "usdt_balance",
                        "usdc_balance",
                        "total_usd_value",
                        "snapshot_time",
                    ],
                )
                writer.writeheader()
                writer.writerows(rows)
        logger.info(f"CSV output written to {filepath}")
    except Exception as e:
        logger.error(f"Failed to write CSV output: {e}")
        raise

    return filepath
