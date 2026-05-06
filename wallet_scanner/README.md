# Wallet Scanner

轻量级加密货币钱包账户扫描工具，支持 EVM 链（ETH/BSC/Polygon/Arbitrum/Base）+ Solana。

## 功能特性

- BIP-39 12 词助记词地址派生
- 多链聚合余额查询（Moralis EVM + Helius Solana），单次调用返回所有代币（含 USDT/USDC）
- USD 估值阈值过滤（默认 $10）
- Notion 数据库自动写入
- JSON/CSV 双格式输出
- 资源占用轻量（CPU 单核，内存 <500MB）

## 前置准备

### 1. 注册免费 API

| 服务 | 注册地址 | 免费额度 | 说明 |
|------|---------|---------|------|
| **Moralis**（EVM 聚合余额） | https://moralis.io/ | 100,000 次/天 | 注册后获取 API Key |
| **Helius**（Solana RPC） | https://helius.xyz/ | 100,000 CU/天 | Dashboard 获取 RPC 端点 |
| **Notion** | https://www.notion.so/my-integrations | — | 创建 Integration，分享数据库 |

Coingecko 价格 API **无需注册**。

### 免费额度估算（SCAN_DEPTH=10）

| 链 | API | 每日上限 |
|----|-----|---------|
| EVM（5 条链） | Moralis | ~10,000 条助记词/天 |
| Solana | Helius | ~4,000 条助记词/天 |
| **整体瓶颈** | **Solana** | **~4,000 条/天** |

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

### .env 配置说明

```env
# Moralis API Key（EVM 聚合余额，100K 次/天）
MORALIS_API_KEY=your_key_here

# Helius RPC URL（Solana）
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key_here

# Notion
NOTION_API_KEY=secret_xxx
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 扫描参数（可选，不填用默认值）
SCAN_DEPTH=10           # 每条助记词派生的地址数量
THRESHOLD_USD=10.0      # 余额阈值，>= 此值才写入 Notion
```

## 使用方法

### 准备助记词文件

每行一条 12 词助记词（空格分隔），文件需设为 `chmod 600`：

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
python main.py --mnemonic-file ./mnemonics.txt --chains ethereum,bsc,solana --depth 10

# 指定阈值
python main.py --mnemonic-file ./mnemonics.txt --threshold 10.0

# 跳过本地文件，仅写 Notion
python main.py --mnemonic-file ./mnemonics.txt --notion-only
```

### 输出

- JSON: `results/20250101_120000_scan_results.json`
- CSV: `results/20250101_120000_scan_results.csv`
- Notion: 自动写入数据库（总估值 >= $10 才写入）

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
│   ├── evm.py            # EVM 链查询（Moralis）
│   ├── solana.py         # Solana 链查询（Helius）
│   ├── filter.py         # 余额过滤
│   ├── notion.py         # Notion 写入
│   ├── output.py         # 输出格式化
│   └── resource_guard.py # 资源限制
├── main.py               # CLI 入口
├── config.yaml           # 配置文件
├── .env.example          # 环境变量模板
├── deploy.sh             # VPS 部署脚本
├── requirements.txt
└── README.md
```

## 故障排除

- **Moralis/Helius 限流**：降低 `max_concurrent` 或增加 `scan_interval_ms`
- **Notion 写入失败**：检查 `failed_notion_writes.jsonl`，手动补录
- **内存超限**：减少 `SCAN_DEPTH` 或批次大小
