# Crypto Wallet Account Scanner Spec

## Why

用户需要在有限资源的 VPS（2 vCPU / 4GB RAM）上运行一个轻量级脚本，对自有的 12 词助记词进行安全、可控的资产扫描，输出各链余额与代币信息。脚本必须不干扰同 VPS 其他服务的稳定运行，且助记词不出内存/磁盘明文。

## What Changes

- 新增 Python 扫描脚本 `wallet_scanner/`
- 支持 EVM（Ethereum、BSC、Polygon、Arbitrum、Base）+ Solana 链
- BIP-39 助记词仅在内存中派生地址，不写入磁盘
- 资源限制：CPU 单核占用，内存峰值 < 500MB，并发请求受控
- 输出 JSON + CSV 双格式，包含余额、代币、NFT 摘要
- 可配置扫描深度（派生地址数量）、扫描间隔、RPC 端点
- **余额过滤**：只保留 ETH/BNB/SOL/USDT/USDC 总估值超过 $10 的账户，其余舍弃
- **Notion 写入**：通过余额检测的助记词索引（非明文）+ 钱包地址写入 Notion 数据库

## Impact

- **新增代码**：`wallet_scanner/` 目录（CLI 工具）
- **运行时依赖**：Python 3.11+，第三方库（bip-utils、solana、requests、aiohttp、notion-client）
- **外部依赖**：公共 RPC 端点（EVM：Alchemy/Cloudflare 等；Solana：官方公开节点）；Notion API
- **安全边界**：助记词文件仅读取模式，内存处理，不落盘；写入 Notion 的仅为助记词索引编号，不含助记词明文

## ADDED Requirements

### Requirement: 助记词安全处理

系统 **SHALL** 在内存中完成所有助记词解析与地址派生操作；助记词明文不得写入日志、磁盘、swap 或任何持久化存储。

#### Scenario: 正常扫描
- **WHEN** 用户以配置文件指定助记词文件路径并运行脚本
- **THEN** 脚本仅读取文件内容，完成派生后立即释放内存，不产生任何包含助记词的输出

#### Scenario: 异常中断
- **WHEN** 脚本运行中被强制终止（SIGKILL/崩溃）
- **THEN** 操作系统 swap 文件中不得包含助记词明文（通过 mlock 防止换页或明确告知用户禁用 swap）

### Requirement: EVM 链扫描

系统 **SHALL** 支持 Ethereum、BSC、Polygon、Arbitrum、Base 五条 EVM 链，支持 BIP-44 标准派生路径（`m/44'/60'/0'/0/i`），查询原生币余额及常见 ERC-20 代币余额。

#### Scenario: 单助记词扫描
- **WHEN** 用户对一条 12 词助记词扫描前 20 个地址（索引 0-19）
- **THEN** 输出该助记词在每条 EVM 链（ETH/BSC/MATIC/ARB/Base）上的 20 个派生地址及其 ETH/BNB/MATIC 等原生余额

#### Scenario: 代币余额查询
- **WHEN** 用户在配置文件中指定要查询的代币合约地址列表
- **THEN** 对每条链上每个地址执行代币余额批量查询（multicall），并输出非零余额的代币

### Requirement: Solana 链扫描

系统 **SHALL** 支持 Solana 链，支持 SLIP-10 Ed25519 派生路径，查询 SOL 余额及 SPL 代币。

#### Scenario: Solana 地址派生
- **WHEN** 用户对一条助记词扫描 Solana 地址
- **THEN** 使用 Ed25519 curve 派生地址，而非 EVM 的 secp256k1，并查询对应钱包的 SOL 与 SPL 代币

### Requirement: 资源占用控制

系统 **SHALL** 在 2 vCPU / 4GB RAM VPS 环境下不超过以下阈值：CPU 单核 100%（即不超过 1 核满载）；内存峰值 500MB；并发 RPC 请求 ≤ 10。

#### Scenario: 扫描过程中
- **WHEN** 脚本正在扫描 100 条助记词，每条 20 个地址
- **THEN** CPU 占用 ≤ 15%，内存 ≤ 500MB，磁盘 I/O 仅写入输出文件，不产生大量临时文件

### Requirement: 可配置扫描参数

系统 **SHALL** 通过 YAML 配置文件或命令行参数配置：助记词文件路径、要扫描的链列表、每个助记词派生的地址数量上限、RPC 端点与 API Key、扫描间隔（每请求间隔 ms）、输出文件路径。

#### Scenario: 自定义配置
- **WHEN** 用户通过 CLI 指定 `--chains ethereum,bsc --depth 50 --output results.json`
- **THEN** 脚本按配置仅扫描 Ethereum 和 BSC，每条助记词派生 50 个地址，结果写入 results.json

### Requirement: 输出格式

系统 **SHALL** 同时输出 JSON（结构化，便于程序解析）和 CSV（便于人类阅读）两种格式；JSON/CSV 均不含任何助记词明文，仅包含派生地址、链名、余额快照时间戳。

#### Scenario: 扫描完成
- **WHEN** 扫描全部完成
- **THEN** 在指定目录生成 `{timestamp}_scan_results.json` 和 `{timestamp}_scan_results.csv`

### Requirement: 余额过滤

系统 **SHALL** 在每条助记词扫描完成后，计算该助记词所有链（ETH/BNB/SOL）及常见代币（USDT/USDC）的总美元估值；**仅当总估值超过 $10 时才保留该账户**，否则丢弃（不写入输出文件、不写入 Notion）。

#### Scenario: 总估值不足 $10
- **WHEN** 一条助记词的所有派生地址在所有链上的 ETH + BNB + SOL + USDT + USDC 总价值 < $10
- **THEN** 该助记词结果不写入任何输出，完全跳过

#### Scenario: 总估值达标
- **WHEN** 一条助记词的总资产估值 ≥ $10
- **THEN** 该助记词及其所有非零余额地址被标记为"通过"，写入输出文件并尝试写入 Notion

### Requirement: Notion 数据库写入

系统 **SHALL** 将通过余额检测的账户写入用户指定的 Notion 数据库；写入内容不含助记词明文，仅包含助记词索引编号、钱包地址、链名、资产快照、USD 估值。

#### Scenario: Notion 写入成功
- **WHEN** 一条助记词通过余额检测且 Notion 数据库配置正确
- **THEN** 在 Notion 数据库中新增一行，包含该助记词对应的各链地址、余额快照及估值

#### Scenario: Notion 写入失败
- **WHEN** Notion API 调用失败（网络错误/权限不足/数据库不存在）
- **THEN** 脚本记录错误日志，继续扫描，不阻塞后续任务；失败条目记录到本地 `failed_notion_writes.jsonl` 供人工补录

### Notion 数据表字段设计

Notion 数据库应包含以下字段：

| 字段名（英文） | 字段名（中文） | 类型 | 说明 |
|---|---|---|---|
| MnemonicIndex | 助记词索引 | Number | 该助记词在种子文件中的行号（从 1 开始），不含助记词明文 |
| WalletAddress | 钱包地址 | Rich Text | 具体链上的钱包地址 |
| Chain | 链名 | Select | Ethereum / BSC / Polygon / Arbitrum / Base / Solana |
| CoinBalance | 原生币余额 | Number | 如 ETH=0.5，保留 8 位小数 |
| USDTBalance | USDT 余额 | Number | 单位 USDT |
| USDCBalance | USDC 余额 | Number | 单位 USDC |
| TotalUSDValue | 总 USD 估值 | Number | 该地址上所有资产折算美元总值 |
| SnapshotTime | 快照时间 | Date | ISO 8601 格式 |
| Status | 状态 | Select | Passed（通过）/ Failed（不足 $10） |

## MODIFIED Requirements

无。

## REMOVED Requirements

无。

## Architecture

```
wallet_scanner/
├── scanner/              # 核心扫描模块
│   ├── __init__.py
│   ├── mnemonic.py       # BIP-39 助记词解析与派生
│   ├── evm.py            # EVM 链 RPC 客户端与地址派生
│   ├── solana.py         # Solana RPC 客户端与地址派生
│   ├── config.py         # 配置加载与参数校验
│   ├── output.py         # JSON/CSV 输出格式化
│   ├── filter.py         # 余额过滤（$10 阈值）
│   └── notion.py         # Notion 数据库写入
├── main.py               # CLI 入口
├── requirements.txt
├── config.yaml           # 示例配置文件
└── README.md
```

## Security Notes

- 助记词文件路径通过命令行传入，不硬编码
- 日志级别默认 INFO，不记录任何 seed/私钥
- 建议配合 AppArmor/systemd 限制脚本文件系统访问
- 生产使用建议：通过环境变量注入 RPC API Key，而非配置文件明文
- Notion API Token 通过环境变量 `NOTION_API_KEY` 注入，不写入配置文件
- 写入 Notion 的仅为助记词行号索引，不含助记词明文；用户需自行在本地维护"索引→助记词"对应表
