"""CLI entry point for wallet scanner."""

import argparse
import asyncio
import os
import signal
import sys
from datetime import datetime, timezone

from tqdm import tqdm

from scanner import config, evm, filter as scanner_filter, mnemonic, notion, output, solana


SOLANA_MINT_ADDRESSES = {
    "USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDg1v",
}

NOTION_ONLY = False
SHUTDOWN_REQUESTED = False


def _setup_signal_handlers(loop: asyncio.AbstractEventLoop):
    def _handle_signal(sig: signal.Signals):
        global SHUTDOWN_REQUESTED
        if not SHUTDOWN_REQUESTED:
            SHUTDOWN_REQUESTED = True
            print(f"\n收到信号 {sig.name}，正在完成当前任务后退出...")

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal, sig)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Wallet Scanner - 扫描加密货币钱包余额",
    )
    parser.add_argument(
        "--mnemonic-file",
        required=True,
        help="助记词文件路径（每行一条）",
    )
    parser.add_argument(
        "--config",
        default=None,
        help="YAML 配置文件路径（可选）",
    )
    parser.add_argument(
        "--chains",
        default=None,
        help="扫描的链列表，逗号分隔，如 ethereum,bsc,solana",
    )
    parser.add_argument(
        "--depth",
        type=int,
        default=None,
        dest="depth",
        help="派生地址数量（默认从 .env 的 SCAN_DEPTH 读取）",
    )
    parser.add_argument(
        "--output-dir",
        default="./results",
        help="输出目录（默认 ./results）",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        dest="threshold",
        help="USD 阈值（默认从 .env 的 THRESHOLD_USD 读取）",
    )
    parser.add_argument(
        "--notion-only",
        action="store_true",
        help="仅写入 Notion（跳过本地文件输出）",
    )
    return parser.parse_args()


async def _scan_mnemonic(
    mnemonic_str: str,
    chains: list[str],
    depth: int,
    max_concurrent: int,
    interval_ms: int,
    moralis_api_key: str,
    helius_rpc_url: str,
    prices: dict[str, float],
    threshold: float,
) -> tuple[dict, float] | None:
    global SHUTDOWN_REQUESTED
    if SHUTDOWN_REQUESTED:
        return None

    derived = mnemonic.derive_addresses(mnemonic_str, depth)

    evm_chains = [c for c in chains if c != "solana"]
    scan_solana = "solana" in chains

    tasks: list[tuple[str, asyncio.Task]] = []

    for chain in evm_chains:
        if chain in derived and derived[chain]:
            task = asyncio.create_task(
                evm.scan_evm_addresses(
                    moralis_api_key,
                    derived[chain],
                    chain,
                    max_concurrent,
                    interval_ms,
                )
            )
            tasks.append((chain, task))

    if scan_solana and "solana" in derived and derived["solana"]:
        task = asyncio.create_task(
            solana.scan_solana_addresses(
                helius_rpc_url,
                derived["solana"],
                SOLANA_MINT_ADDRESSES,
                max_concurrent,
                interval_ms,
            )
        )
        tasks.append(("solana", task))

    if not tasks:
        return None

    scan_results = await asyncio.gather(*[t[1] for t in tasks], return_exceptions=True)

    all_addresses: dict[str, list[dict]] = {}
    for i, (chain_name, _) in enumerate(tasks):
        if isinstance(scan_results[i], Exception):
            continue
        all_addresses[chain_name] = scan_results[i]

    for chain in evm_chains + (["solana"] if scan_solana else []):
        if chain not in all_addresses:
            all_addresses[chain] = []

    all_addresses_flat: list[dict] = []
    for chain, addr_list in all_addresses.items():
        for addr_info in addr_list:
            addr_info_copy = dict(addr_info)
            addr_info_copy["chain"] = chain
            all_addresses_flat.append(addr_info_copy)

    total_usd = scanner_filter.calculate_total_usd(all_addresses_flat, prices)

    return (all_addresses, total_usd)


def _build_notion_pages(
    all_addresses: dict[str, list[dict]],
    total_usd: float,
    mnemonic_index: int,
    snapshot_time: str,
) -> list[dict]:
    pages: list[dict] = []
    for chain, addr_list in all_addresses.items():
        for addr_info in addr_list:
            if chain == "solana":
                native_balance = addr_info.get("sol", 0.0)
            else:
                native_balance = addr_info.get("native_balance", 0.0) or 0.0

            pages.append({
                "mnemonic_index": mnemonic_index,
                "chain": chain,
                "address": addr_info.get("address", ""),
                "native_balance": native_balance,
                "usdt": addr_info.get("usdt", 0.0),
                "usdc": addr_info.get("usdc", 0.0),
                "total_usd": total_usd,
                "snapshot_time": snapshot_time,
            })
    return pages


async def main_async(args: argparse.Namespace) -> None:
    global NOTION_ONLY

    chains_input = args.chains
    if chains_input:
        chains = [c.strip() for c in chains_input.split(",")]
    else:
        chains = None

    cfg = config.load_config(
        chains=chains,
        depth=args.depth,
        output_dir=args.output_dir,
        threshold_usd=args.threshold,
    )

    mnemonics = mnemonic.load_mnemonics(args.mnemonic_file)
    if not mnemonics:
        print("未找到助记词或文件为空")
        return

    print(f"加载了 {len(mnemonics)} 条助记词")
    print(f"扫描链: {', '.join(cfg.chains)}")
    print(f"派生深度: {cfg.depth}")
    print(f"USD 阈值: ${cfg.threshold_usd}")

    prices = await scanner_filter.get_prices()
    print(f"当前价格: ETH=${prices.get('ethereum', 0):.2f}, SOL=${prices.get('solana', 0):.2f}, USDT=${prices.get('tether', 0):.4f}")

    os.makedirs(cfg.output_dir, exist_ok=True)

    results: list[dict] = []
    notion_pages: list[dict] = []
    passed_count = 0

    snapshot_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    NOTION_ONLY = args.notion_only

    loop = asyncio.get_event_loop()
    _setup_signal_handlers(loop)

    with tqdm(total=len(mnemonics), desc="Scanning mnemonics", unit="mnemonic") as pbar:
        for idx, (line_num, mnemonic_str) in enumerate(mnemonics):
            if SHUTDOWN_REQUESTED:
                print(f"\n优雅退出，已处理 {idx}/{len(mnemonics)} 条")
                break

            pbar.set_description(f"Scanning mnemonic {idx + 1}/{len(mnemonics)}")
            pbar.update(1)

            scan_result = await _scan_mnemonic(
                mnemonic_str,
                cfg.chains,
                cfg.depth,
                cfg.max_concurrent,
                cfg.scan_interval_ms,
                cfg.moralis_api_key,
                cfg.helius_rpc_url,
                prices,
                cfg.threshold_usd,
            )

            if scan_result is None:
                continue

            all_addresses, total_usd = scan_result

            if scanner_filter.should_keep(total_usd, cfg.threshold_usd):
                passed_count += 1
                aggregated = output.aggregate_results(all_addresses, line_num, snapshot_time)
                aggregated["total_usd_value"] = total_usd

                for addr in aggregated.get("addresses", []):
                    addr["total_usd_value"] = total_usd

                if NOTION_ONLY:
                    pages = _build_notion_pages(all_addresses, total_usd, line_num, snapshot_time)
                    notion_pages.extend(pages)
                else:
                    results.append(aggregated)

    scan_time_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if notion_pages:
        print("\n正在写入 Notion...")
        success, failed = await notion.batch_write_to_notion(
            cfg.notion_api_key,
            cfg.notion_database_id,
            notion_pages,
            max_concurrent=cfg.max_concurrent,
        )
        print(f"Notion written: {success} pages ({failed} failed)")

    json_path = None
    csv_path = None

    if not NOTION_ONLY and results:
        json_path = output.write_json_output(
            cfg.output_dir,
            results,
            cfg.threshold_usd,
            scan_time_str,
        )
        csv_path = output.write_csv_output(
            cfg.output_dir,
            results,
            scan_time_str,
        )

    total_scanned = len(results) if not NOTION_ONLY else passed_count

    print("\nScan complete!")
    print(f"Total scanned: {total_scanned}")
    print(f"Passed threshold: {passed_count}")
    if json_path:
        print(f"JSON output: {json_path}")
    if csv_path:
        print(f"CSV output: {csv_path}")


def main() -> None:
    args = parse_args()

    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\n\n收到键盘中断，正在退出...")
        sys.exit(0)
    except Exception as e:
        print(f"\n发生错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
