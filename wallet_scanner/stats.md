---
scan_status: "SUCCESS"
scan_date_utc: "2026-07-07T00:49:59Z"
duration_seconds: 9888
mnemonics_count: 2000
mnemonics_hash: "d0ad287f"
depth: 5
chains: [ethereum,solana]
eth_tokens: [USDT USDC]
sol_tokens: [USDT USDC]
total_addresses_ethereum: 10000
total_addresses_solana: 10000
etherscan_calls: 20500
etherscan_calls_limit: 100000
etherscan_rate_percent: 20.5
notion_pages_written: -
notion_failed: -
passed_threshold: 0
errors: []
---

# Wallet Scanner Stats

## Run Status
- **Status**: SUCCESS
- **Scan Time (UTC)**: 2026-07-07T00:49:59Z
- **Duration**: 02:44:48
- **Code Version**: `9ac1ead`

## Configuration
| Parameter | Value |
|----------|-------|
| Mnemonics | 2000 |
| Depth | 5 |
| Chains | ethereum,solana |
| ETH Tokens | USDT USDC |
| SOL Tokens | USDT USDC |
| Threshold (USD) | $5.0 |
| Etherscan Interval | 350ms |
| Solana Interval | 3000ms |
| Max Concurrent | 1 |
| Etherscan Usage | 20500 / 100,000 (20.5%) |

## Results
| Metric | Value |
|-------|-------|
| Derived Addresses (ETH) | 10000 |
| Derived Addresses (SOL) | 10000 |
| Passed Threshold | 0 |
| Pass Rate | 0.000% |
| Notion Written | - pages |
| Notion Failed | - |

## Output Files
- JSONL: `-`
- CSV: `-`

## Etherscan Errors
- HTTP 400: 0
- Timeout: 0
- Other: 0
