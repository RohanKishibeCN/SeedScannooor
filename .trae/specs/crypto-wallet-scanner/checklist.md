# Checklist

## 功能性验收

- [ ] EVM 五链（ETH/BSC/Polygon/Arbitrum/Base）均可通过公共 RPC 查询原生币余额
- [ ] Solana 链可通过官方公开 RPC 查询 SOL 余额
- [ ] BIP-39 12 词助记词可正确派生 EVM（secp256k1）与 Solana（Ed25519）地址
- [ ] 派生地址数量可配置（默认 20，可通过 `--depth` 调整）
- [ ] ERC-20 代币余额可通过 multicall 批量查询，非零余额正确输出
- [ ] SPL 代币余额正确输出
- [ ] 通过 Coingecko 等公开 API 实时查询 ETH/BNB/SOL/USDT/USDC 美元价格
- [ ] 每条助记词正确汇总所有链、所有地址的资产总估值
- [ ] 总估值 < $10 的账户不写入任何输出，不写入 Notion（严格过滤）
- [ ] 总估值 ≥ $10 的账户正确写入 Notion 数据库（字段与 spec 一致）
- [ ] JSON 输出文件包含：助记词索引、链名、派生地址、余额、代币、时间戳
- [ ] CSV 输出文件包含：助记词索引、链名、派生地址、原生余额、代币余额、时间戳
- [ ] CLI 支持 `--config`、`--chains`、`--depth`、`--output` 参数
- [ ] YAML 配置文件可完整覆盖所有 CLI 参数
- [ ] 进度条实时显示已扫描助记词数 / 总数
- [ ] SIGINT / SIGTERM 可优雅退出（已完成扫描的结果不丢失）

## 资源占用验收

- [ ] 脚本运行时 CPU 单核占用 ≤ 15%（2 vCPU 环境下总占用 ≤ 7.5%）
- [ ] 内存峰值 ≤ 500MB
- [ ] 并发 RPC 请求数始终 ≤ 10
- [ ] 扫描过程中不影响同 VPS 其他服务响应（无端口冲突、无 OOM）

## 安全验收

- [ ] Notion API Token 通过环境变量 `NOTION_API_KEY` 注入，不写入配置文件
- [ ] 写入 Notion 的仅为助记词行号索引，不含助记词明文
- [ ] Notion 写入失败时记录到 `failed_notion_writes.jsonl`，不阻塞扫描继续
- [ ] Notion 数据库字段与 spec 中字段设计一致（MnemonicIndex/WalletAddress/Chain/CoinBalance/USDTBalance/USDCBalance/TotalUSDValue/SnapshotTime/Status）
- [ ] 助记词明文不写入日志文件（即使日志级别为 DEBUG）
- [ ] 助记词明文不写入磁盘、swap、core dump
- [ ] 输出 JSON/CSV 文件不含任何助记词、私钥、seed 相关信息
- [ ] 助记词文件仅读取模式访问，脚本不创建/修改/覆盖该文件
- [ ] `.env.example` 包含所有 8 个必需环境变量的示例，占位符清晰
- [ ] 所有密钥（RPC URL / Notion Key）均从 `.env` 读取，不硬编码
- [ ] `.env` 修改后无需重启，下次运行自动读取最新值

## 代码质量验收

- [ ] 所有模块有类型标注（type hints）
- [ ] 所有公开函数有 docstring
- [ ] 单元测试覆盖助记词派生、EVM RPC 响应解析、Solana RPC 响应解析、输出格式化、$10 阈值过滤边界值测试（$9.99 / $10 / $10.01）
- [ ] 无硬编码助记词或私钥（测试用例除外，且测试用例使用公开已知种子）
- [ ] requirements.txt 固定主要依赖版本
