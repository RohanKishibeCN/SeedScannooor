# 计划：用 TypeScript（Node.js CLI）重写 SeedScannooor

## Summary
- 将现有 Python 项目 [wallet_scanner](file:///workspace/wallet_scanner) 直接替换为 TypeScript（Node.js）实现，保持现有 CLI 参数、默认值、输出 JSON/CSV 结构、Notion 字段映射尽量完全兼容。
- 同步迁移部署脚本 [deploy.sh](file:///workspace/wallet_scanner/deploy.sh)（含 cron）到 Node 版本，并更新 GitHub Actions 工作流 [generate-mnemonics.yml](file:///workspace/.github/workflows/generate-mnemonics.yml) 从 Python 迁移到 Node。

## Current State Analysis
- 代码主体在 [wallet_scanner](file:///workspace/wallet_scanner)：
  - CLI 入口：[main.py](file:///workspace/wallet_scanner/main.py)
  - 核心模块：[scanner/](file:///workspace/wallet_scanner/scanner)
    - 配置加载：[config.py](file:///workspace/wallet_scanner/scanner/config.py)
    - 助记词派生：[mnemonic.py](file:///workspace/wallet_scanner/scanner/mnemonic.py)
    - EVM 余额（Tatum）：[evm.py](file:///workspace/wallet_scanner/scanner/evm.py)
    - Solana 余额（JSON-RPC）：[solana.py](file:///workspace/wallet_scanner/scanner/solana.py)
    - Coingecko 价格与阈值过滤：[filter.py](file:///workspace/wallet_scanner/scanner/filter.py)
    - 本地输出 JSON/CSV：[output.py](file:///workspace/wallet_scanner/scanner/output.py)
    - Notion 写入（批量）：[notion.py](file:///workspace/wallet_scanner/scanner/notion.py)
    - 资源防护（目前未在主流程强绑定）：[resource_guard.py](file:///workspace/wallet_scanner/scanner/resource_guard.py)
  - 配置文件：[config.yaml](file:///workspace/wallet_scanner/config.yaml)，环境变量模板：[.env.example](file:///workspace/wallet_scanner/.env.example)
  - Python 依赖：[requirements.txt](file:///workspace/wallet_scanner/requirements.txt)
- 仓库根目录存在助记词生成脚本 [generate_mnemonics.py](file:///workspace/generate_mnemonics.py)，并由 GitHub Actions 定时执行生成 [mnemonics.txt](file:///workspace/mnemonics.txt)。

## Goals / Success Criteria
- 保持与现有 Python CLI 行为一致：
  - CLI 参数：`--mnemonic-file`、`--config`、`--chains`、`--depth`、`--output-dir`、`--threshold`、`--notion-only`
  - 默认值与配置优先级保持一致（参照 [config.py](file:///workspace/wallet_scanner/scanner/config.py#L171-L324)）
  - 输出文件命名、字段结构与当前结果一致（参照 [output.py](file:///workspace/wallet_scanner/scanner/output.py) 与 [main.py](file:///workspace/wallet_scanner/main.py#L182-L300)）
  - Notion 写入字段映射与当前一致（参照 [notion.py](file:///workspace/wallet_scanner/scanner/notion.py#L58-L68)）
- 类型安全：核心数据结构用 TypeScript 类型显式建模。
- 安全约束：任何日志/输出不得包含助记词原文（延续测试意图：见 [test_scanner.py](file:///workspace/wallet_scanner/tests/test_scanner.py#L71-L111)）。
- 部署与自动化：
  - 提供 Node 版本的 `deploy.sh`（安装依赖、配置 .env、测试运行、写入 cron）。
  - GitHub Actions 迁移为 Node 运行生成 mnemonics 的脚本。

## Proposed Changes (Files & What/Why/How)

### 1) 将 wallet_scanner 目录转换为 Node.js TypeScript 项目（替换 Python 实现）
- **新增** [wallet_scanner/package.json](file:///workspace/wallet_scanner/package.json)
  - `type: "module"`（或 CommonJS，二选一；本计划采用 ESM）
  - scripts：`build`, `start`, `test`, `lint`（lint 若不引入 eslint 可省略）
  - engines：`node >= 18`（使用内置 fetch，减少依赖）
- **新增** [wallet_scanner/tsconfig.json](file:///workspace/wallet_scanner/tsconfig.json)
  - `outDir: "dist"`, `rootDir: "src"`, `moduleResolution: "Bundler" | "NodeNext"`（按 ESM 选择 NodeNext）
- **新增** [wallet_scanner/src/](file:///workspace/wallet_scanner/src)（替代现有 [scanner/](file:///workspace/wallet_scanner/scanner)）
  - `src/config.ts`
    - 读取 `.env`（优先 `wallet_scanner/.env` 与 `cwd/.env`），解析 `config.yaml`
    - 复刻优先级：CLI > .env > YAML > default（与 Python 实现保持一致）
    - 复刻链开关：`CHAIN_*` 与默认链（ethereum + solana）
  - `src/mnemonic.ts`
    - 复刻 BIP39 校验与 BIP44 派生逻辑：
      - EVM：m/44'/60'/0'/0/i（对 bsc/polygon/arbitrum/base 仍用 60；保持与 Python 一致）
      - Solana：m/44'/501'/0'/0'/i'（保持与 Python 一致，注意最后一段硬化）
    - 输出格式：`{ ethereum: string[], bsc: string[], polygon: string[], arbitrum: string[], base: string[], solana: string[] }`
  - `src/evm.ts`
    - 调用 Tatum v4 portfolio API（与 [evm.py](file:///workspace/wallet_scanner/scanner/evm.py#L7-L89) 逻辑一致）
    - 并发与限流：使用自实现 semaphore + `sleep(intervalMs)`；错误时返回零余额结构
  - `src/solana.ts`
    - JSON-RPC 调用 `getBalance` 与 `getTokenAccountsByOwner`（与 [solana.py](file:///workspace/wallet_scanner/scanner/solana.py) 一致）
    - token mint 映射沿用 [main.py](file:///workspace/wallet_scanner/main.py#L15-L18) 的 USDT/USDC 地址
  - `src/filter.ts`
    - 调用 Coingecko simple price API，内存 TTL 缓存 5 分钟（与 [filter.py](file:///workspace/wallet_scanner/scanner/filter.py#L38-L69) 一致）
    - `calculateTotalUsd` 与 `shouldKeep`
  - `src/output.ts`
    - `aggregateResults` / `writeJsonOutput` / `writeCsvOutput`
    - 保持文件名格式：`YYYYMMDD_HHMMSS_scan_results.(json|csv)`（见 [output.py](file:///workspace/wallet_scanner/scanner/output.py#L15-L17)）
  - `src/notion.ts`
    - 使用官方 `@notionhq/client` 或直接 REST（两者选其一；本计划采用官方 client + 批量并发写入时用 fetch/REST 更可控）
    - 实现 `validateDatabase`、`batchWriteToNotion`，失败落盘 `failed_notion_writes.jsonl`
  - `src/resourceGuard.ts`
    - 在 Node 中实现轻量版：并发守卫（semaphore）、可选内存使用检查（读取 `process.memoryUsage()`），并保留 `max_concurrent` 作为主要资源控制入口
  - `src/cli.ts`（或 `src/index.ts`）
    - 解析 CLI 参数（保持与 Python 参数名一致）
    - 主流程对齐 [main.py](file:///workspace/wallet_scanner/main.py#L182-L300)：
      - 加载配置 → 加载助记词 → 获取价格 → 并发扫描各链 → 计算 totalUsd → threshold 过滤
      - notion-only 分支：构造 Notion pages 并批量写入
      - 否则：聚合 results 并落盘 JSON/CSV
    - 优雅退出：监听 SIGINT/SIGTERM，完成当前助记词后停止（对齐 Python 的 SHUTDOWN_REQUESTED 语义）
- **删除/弃用** Python 文件（执行阶段实施）：
  - [wallet_scanner/main.py](file:///workspace/wallet_scanner/main.py)
  - [wallet_scanner/scanner/](file:///workspace/wallet_scanner/scanner) 下全部 `.py`
  - [wallet_scanner/requirements.txt](file:///workspace/wallet_scanner/requirements.txt)
  - [wallet_scanner/tests/test_scanner.py](file:///workspace/wallet_scanner/tests/test_scanner.py)（迁移为 TS 测试）

### 2) 测试体系迁移到 TypeScript
- **新增** [wallet_scanner/vitest.config.ts](file:///workspace/wallet_scanner/vitest.config.ts)（若使用 vitest）
- **新增/替换** [wallet_scanner/tests/](file:///workspace/wallet_scanner/tests)
  - `mnemonic.test.ts`：覆盖派生结果 key 完整性、invalid mnemonic 行为
  - `filter.test.ts`：覆盖阈值判断与 totalUsd 计算
  - `output.test.ts`：覆盖时间戳格式、输出不包含助记词（对齐 Python 测试意图）
  - `evm.test.ts` / `solana.test.ts`：用 HTTP mock（如 `nock`）验证错误分支返回零余额
- 测试不做真实网络请求；所有外部 API 使用 mock。

### 3) 迁移助记词生成脚本与 GitHub Actions
- **新增** `scripts/generate-mnemonics.ts`（建议放在仓库根目录或 `wallet_scanner/scripts/`）
  - 功能对齐 [generate_mnemonics.py](file:///workspace/generate_mnemonics.py)：生成 N 条 12 词英文助记词写入目标文件
  - Node 依赖：`bip39`（可生成 mnemonic）
- **修改** [generate-mnemonics.yml](file:///workspace/.github/workflows/generate-mnemonics.yml)
  - 改为 setup-node + `npm ci` + `node scripts/generate-mnemonics.js ...`（或 `npm run generate-mnemonics -- ...`）
  - 移除 Python 安装步骤
- **删除/弃用** [generate_mnemonics.py](file:///workspace/generate_mnemonics.py)（执行阶段实施）

### 4) 更新文档与部署脚本（Node 版本）
- **修改** [wallet_scanner/README.md](file:///workspace/wallet_scanner/README.md)
  - 安装方式改为 `npm ci` / `npm run build`
  - 运行方式改为 `node dist/cli.js ...` 或 `npm start -- ...`
  - .env 配置说明保持一致（复用 [.env.example](file:///workspace/wallet_scanner/.env.example)）
- **修改** [wallet_scanner/deploy.sh](file:///workspace/wallet_scanner/deploy.sh)
  - 依赖检查从 Python 改为 Node（node/npm）
  - 安装依赖：`npm ci && npm run build`
  - 测试运行：用少量助记词 + depth=2 跑一次
  - cron 执行命令改为 `node dist/cli.js --mnemonic-file ...`

## Assumptions & Decisions (Locked)
- 采用 **Node.js CLI** 作为运行方式，TypeScript 编译产物输出到 `wallet_scanner/dist/`。
- **完全兼容** 现有 CLI 参数、默认行为、输出 JSON/CSV 结构与 Notion 字段映射。
- **直接替换** Python 版本：迁移完成后移除 Python 源码与依赖文件（保留历史可通过 git 找回）。
- 依赖选择（执行阶段以 package.json 固化）：
  - `.env`：dotenv
  - YAML：js-yaml
  - HTTP：Node 内置 fetch（必要时用 undici）
  - BIP39：bip39
  - EVM 地址：ethers（HD 钱包派生）
  - Solana 派生：ed25519-hd-key + tweetnacl + @solana/web3.js
  - Notion：@notionhq/client（或 REST；以实现批量并发稳定为准）
  - 进度条：cli-progress（或同级库，需与非 TTY 环境兼容）
  - 测试：vitest + nock

## Interfaces / Data Shapes (TypeScript)
- `Config`
  - `tatumApiKey: string`
  - `heliusRpcUrl: string`
  - `notionApiKey: string`
  - `notionDatabaseId: string`
  - `chains: Array<"ethereum"|"bsc"|"polygon"|"arbitrum"|"base"|"solana">`
  - `depth: number`
  - `outputDir: string`
  - `thresholdUsd: number`
  - `maxConcurrent: number`
  - `scanIntervalMs: number`
- `EvmAddressBalance`
  - `{ address: string; native_balance: number; usdt: number; usdc: number; raw_tokens: unknown[] }`
- `SolanaAddressBalance`
  - `{ address: string; sol: number; usdt: number; usdc: number }`
- `AggregatedResult`
  - `{ mnemonic_index: number; addresses: Array<...>; total_usd_value: number; snapshot_time: string }`
- `NotionPageData`
  - `{ mnemonic_index: number; chain: string; address: string; native_balance: number; usdt: number; usdc: number; total_usd: number; snapshot_time: string }`

## Edge Cases / Failure Modes
- 无效助记词：跳过派生并返回空地址列表（与 [mnemonic.py](file:///workspace/wallet_scanner/scanner/mnemonic.py#L48-L53) 一致）。
- 外部 API 非 200、超时、网络错误：返回零余额结构，不中断整体扫描（与 Python 一致）。
- Notion 写入失败：按条记录失败原因，追加写入 `failed_notion_writes.jsonl`。
- 退出信号：收到 SIGINT/SIGTERM 后，停止启动新的助记词扫描，完成当前 in-flight 后退出。
- 不记录助记词：日志与输出结构不得包含助记词原文；测试覆盖该约束。

## Verification Steps (Executor Checklist)
- 安装依赖并构建：
  - `cd wallet_scanner && npm ci`
  - `npm run build`
- 运行单元测试：
  - `npm test`
- 端到端手动验证（需要真实 API key，执行阶段可选）：
  - `cp .env.example .env` 并填入真实 key
  - `node dist/cli.js --mnemonic-file ./mnemonics.txt --chains ethereum,solana --depth 2 --output-dir ./results_test`
- 校验产物：
  - 输出 JSON/CSV 文件名与字段结构匹配 Python 版本
  - `failed_notion_writes.jsonl` 在 Notion 写入失败时能正确记录
  - 运行过程不打印助记词

