# Wallet Scanner

轻量级加密货币钱包账户扫描工具，支持 EVM 链（ETH/BSC/Polygon/Arbitrum/Base）+ Solana。

## 功能特性

- BIP-39 12 词助记词地址派生
- 多链余额查询（原生币 + USDT/USDC）
- $10 USD 估值阈值过滤
- Notion 数据库自动写入
- JSON/CSV 双格式输出
- 资源占用轻量（CPU 单核，内存 <500MB）

## 前置准备

### 1. 注册免费 API

| 服务 | 注册地址 | 说明 |
|------|---------|------|
| Alchemy（EVM RPC） | https://www.alchemy.com/ | 每条链创建一个 App，记录 RPC URL |
| Helius（Solana RPC） | https://helius.xyz/ | 免费层，Dashboard 获取 RPC 端点 |
| Notion | https://www.notion.so/my-integrations | 创建 Integration，分享数据库 |

Coingecko 价格 API **无需注册**。

### 2. 创建 Notion 数据库

在 Notion 中新建一个数据库，包含以下字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| MnemonicIndex | Number | 助记词行号 |
| WalletAddress | Title | 钱包地址 |
| Chain | Select | Ethereum/BSC/Polygon/Arbitrum/Base/Solana |
| CoinBalance | Number | 原生币余额 |
| USDTBalance | Number | USDT 余额 |
| USDCBalance | Number | USDC 余额 |
| TotalUSDValue | Number | 总 USD 估值 |
| SnapshotTime | Date | 快照时间 |
| Status | Select | Passed |

## 安装

```bash
cd wallet_scanner
pip install -r requirements.txt
cp .env.example .env
```

编辑 `.env` 文件，填入你的 API Key。

## 配置

编辑 `config.yaml`（可选）或使用命令行参数：

```yaml
chains:
  - ethereum
  - bsc
  - solana
depth: 20
threshold_usd: 10.0
output_dir: "./results"
max_concurrent: 10
```

## 使用方法

### 准备助记词文件

每行一条 12 词助记词（空格分隔）：

```
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo
...
```

### 运行扫描

```bash
# 基本用法
python main.py --mnemonic-file ./mnemonics.txt

# 指定链和深度
python main.py --mnemonic-file ./mnemonics.txt --chains ethereum,bsc,solana --depth 50

# 指定阈值
python main.py --mnemonic-file ./mnemonics.txt --threshold 50.0

# 跳过本地文件，仅写 Notion
python main.py --mnemonic-file ./mnemonics.txt --notion-only
```

### 输出

- JSON: `results/20250101_120000_scan_results.json`
- CSV: `results/20250101_120000_scan_results.csv`
- Notion: 自动写入数据库

## 安全注意事项

1. **助记词文件权限**：设置为仅所有者可读（`chmod 600 mnemonics.txt`）
2. **.env 文件权限**：同上
3. **不要将助记词明文写入日志**
4. **建议禁用 swap**：防止内存数据被换页到磁盘
5. **定期检查**：查看 `failed_notion_writes.jsonl` 是否有写入失败的条目

## 目录结构

```
wallet_scanner/
├── scanner/              # 核心模块
│   ├── config.py         # 配置加载
│   ├── mnemonic.py       # 助记词派生
│   ├── evm.py            # EVM 链查询
│   ├── solana.py         # Solana 链查询
│   ├── filter.py         # 余额过滤
│   ├── notion.py         # Notion 写入
│   ├── output.py         # 输出格式化
│   └── resource_guard.py # 资源限制
├── main.py               # CLI 入口
├── config.yaml           # 配置文件
├── .env.example          # 环境变量模板
├── requirements.txt
└── README.md
```

## 故障排除

- **RPC 限流**：降低 `--max-concurrent` 或增加 `scan_interval_ms`
- **Notion 写入失败**：检查 `failed_notion_writes.jsonl`，手动补录
- **内存超限**：减少 `--depth` 或批次大小
