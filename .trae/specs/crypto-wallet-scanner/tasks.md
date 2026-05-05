# Tasks

## 环境准备

- [ ] Task 1: 初始化项目目录结构，创建 `wallet_scanner/` 及子模块框架，安装基础依赖

## 核心模块

- [ ] Task 2: 配置模块 (`scanner/config.py`)：YAML 配置加载、环境变量注入、参数校验（链列表、深度、并发上限）
- [ ] Task 3: 助记词模块 (`scanner/mnemonic.py`)：BIP-39 解析、种子派生、BIP-44 / SLIP-10 地址生成，内存安全处理
- [ ] Task 4: EVM 链模块 (`scanner/evm.py`)：RPC 异步客户端（Ethereum/BSC/Polygon/Arbitrum/Base）、原生余额查询、ERC-20 multicall 代币查询、并发限流
- [ ] Task 5: Solana 链模块 (`scanner/solana.py`)：Solana RPC 客户端、Ed25519 派生、SOL 余额查询、SPL 代币查询
- [ ] Task 6: 输出模块 (`scanner/output.py`)：JSON / CSV 双格式输出、结果聚合、时间戳格式化，不含助记词明文

## CLI 与集成

- [ ] Task 7: CLI 入口 (`main.py`)：argparse 参数解析、配置文件 + 命令行双模式、进度条显示、优雅退出（SIGINT/SIGTERM）
- [ ] Task 8: 示例配置文件 (`config.yaml`)：所有可配置参数及注释说明
- [ ] Task 9: 资源限制加固：内存峰值监控（不超过 500MB）、CPU 节流（单核 + 调度）、并发请求上限守卫（≤10 并发）

## 测试与安全

- [ ] Task 10: 单元测试：助记词派生（使用已知种子验证地址输出）、RPC mock 测试、EVM multicall 响应解析、输出格式化
- [ ] Task 11: 安全验证：确认日志不输出助记词/私钥、内存释放行为验证

## 文档

- [ ] Task 12: README.md：安装说明、配置指南、使用示例（命令行参数说明）、安全注意事项

# Task Dependencies

- Task 2、3、4、5 可并行开发（各自独立）
- Task 6 依赖 Task 2-5 完成后对接
- Task 7 依赖 Task 2 和 Task 6
- Task 8 依赖 Task 2
- Task 9 依赖 Task 4 和 Task 5
- Task 10 可在 Task 2-6 完成后并行
- Task 11 依赖 Task 3（助记词内存处理）
- Task 12 依赖 Task 7-9
