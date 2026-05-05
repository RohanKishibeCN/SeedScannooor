# Tasks

## 环境准备

- [ ] Task 1: 初始化项目目录结构，创建 `wallet_scanner/` 及子模块框架，安装基础依赖

## 核心模块

- [ ] Task 2: 配置模块 (`scanner/config.py`)：YAML 配置加载、环境变量注入、参数校验（链列表、深度、并发上限）
- [ ] Task 3: 助记词模块 (`scanner/mnemonic.py`)：BIP-39 解析、种子派生、BIP-44 / SLIP-10 地址生成，内存安全处理
- [ ] Task 4: EVM 链模块 (`scanner/evm.py`)：RPC 异步客户端（Ethereum/BSC/Polygon/Arbitrum/Base）、原生余额查询、ERC-20 multicall 代币查询、并发限流
- [ ] Task 5: Solana 链模块 (`scanner/solana.py`)：Solana RPC 客户端、Ed25519 派生、SOL 余额查询、SPL 代币查询
- [ ] Task 6: 输出模块 (`scanner/output.py`)：JSON / CSV 双格式输出、结果聚合、时间戳格式化，不含助记词明文
- [ ] Task 7: 余额过滤模块 (`scanner/filter.py`)：实时价格查询（ETH/BNB/SOL/USDT/USDC）、美元估值计算、$10 阈值过滤逻辑
- [ ] Task 8: Notion 写入模块 (`scanner/notion.py`)：Notion API 集成、数据库查询/新建页面、失败重试与 `failed_notion_writes.jsonl` 兜底

## CLI 与集成

- [ ] Task 9: CLI 入口 (`main.py`)：argparse 参数解析、配置文件 + 命令行双模式、进度条显示、优雅退出（SIGINT/SIGTERM）
- [ ] Task 10: 示例配置文件 (`config.yaml`)：所有可配置参数及注释说明（包括 Notion 数据库 ID、$10 阈值、资产列表）
- [ ] Task 11: 资源限制加固：内存峰值监控（不超过 500MB）、CPU 节流（单核 + 调度）、并发请求上限守卫（≤10 并发）

## 测试与安全

- [ ] Task 12: 单元测试：助记词派生（使用已知种子验证地址输出）、RPC mock 测试、EVM multicall 响应解析、输出格式化、$10 阈值过滤边界值测试
- [ ] Task 13: 安全验证：确认日志不输出助记词/私钥、内存释放行为验证、Notion 写入数据不含明文

## 文档

- [ ] Task 14: README.md：安装说明、配置指南、使用示例（命令行参数说明）、安全注意事项、Notion 数据库创建说明

# Task Dependencies

- Task 2、3、4、5 可并行开发（各自独立）
- Task 6 依赖 Task 2-5 完成后对接
- Task 7 依赖 Task 4、5、6（需要已有余额数据再做过滤）
- Task 8 依赖 Task 7（需要过滤通过的数据再写入）
- Task 9 依赖 Task 2 和 Task 6
- Task 10 依赖 Task 2
- Task 11 依赖 Task 4 和 Task 5
- Task 12 可在 Task 2-8 完成后并行
- Task 13 依赖 Task 3（助记词内存处理）
- Task 14 依赖 Task 9-11
