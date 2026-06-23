# SeedScannooor 全面诊断与优化方案

> 分析日期: 2026-06-23
> 方案: 每天 2,000 条助记词, SCAN_DEPTH=5

---

## 一、方案总览

### 每日运行参数

```
mnemonics.txt = 2,000 条（每天 UTC 22:00 由 GitHub Actions 生成）
SCAN_DEPTH  = 5（每条助记词派生 5 个地址）
总地址数     = 10,000 个 ETH 地址 + 10,000 个 SOL 地址
Etherscan   = 20,500 次调用/天（占免费额度 20.5%）
扫描耗时    ≈ 2 小时
```

### 完整自动化链路

```
                    时间线（北京时间）
                         │
  ┌──────────────────────┼──────────────────────┐
  │ 06:00 (UTC 22:00)    │  GitHub Actions       │
  │                      │  ① 生成 2,000 条助记词  │
  │                      │  ② push → mnemonics.txt│
  ├──────────────────────┼──────────────────────┤
  │ 14:05                │  VPS Cron             │
  │                      │  ① git pull 最新代码    │
  │                      │  ② 执行扫描（~2小时）    │
  │                      │  ③ 生成 stats.md       │
  │                      │  ④ git push stats.md   │
  ├──────────────────────┼──────────────────────┤
  │ ~16:30               │  AI Agent             │
  │                      │  ① 读取 GitHub 上的     │
  │                      │     stats.md          │
  │                      │  ② 分析扫描结果         │
  └──────────────────────┴──────────────────────┘
```

---

## 二、改动一：generate_mnemonics.ts 支持可配置数量

### 2.1 现状

当前 `wallet_scanner/src/generate-mnemonics.ts` 从 CLI 参数读数量，默认 100：

```typescript
// 当前: 只支持第 3 个 CLI 参数
const count = Number.parseInt(process.argv[3] ?? "100", 10);
```

GitHub Actions 每次跑都要执行 `npm ci + npm run build`（装 180 个包），只为生成助记词。

### 2.2 改动：支持环境变量 MNEMONICS_COUNT

```typescript
// 优先级: CLI 参数 > 环境变量 MNEMONICS_COUNT > 默认 2000
const cliCount = process.argv[3];
const envCount = process.env.MNEMONICS_COUNT;
const count = Number.parseInt(cliCount ?? envCount ?? "2000", 10);
```

### 2.3 GitHub Actions 工作流优化

GitHub Actions 仍然用 TypeScript 编译后的 JS，但将生成数量改为环境变量控制：

```yaml
- name: Install dependencies & build
  run: |
    npm ci --prefix wallet_scanner
    npm run build --prefix wallet_scanner

- name: Generate mnemonics
  env:
    MNEMONICS_COUNT: ${{ github.event.inputs.count || vars.MNEMONICS_COUNT || 2000 }}
  run: node wallet_scanner/dist/generate-mnemonics.js mnemonics.txt $MNEMONICS_COUNT
```

改动很小，但解决了核心问题——**数量可配置**。

### 2.4 generate_mnemonics.py 同步改动

虽然 GitHub Actions 用 TS 版，但本地调试时会用 `generate_mnemonics.py`。同步修改默认值为 2000：

```python
# 改动一行
count = int(sys.argv[2]) if len(sys.argv) > 2 else 2000
```

---

## 三、改动二：stats.md 针对 AI 读取优化

### 3.1 现状

当前 `stats.md` 只有纯文字描述，不利于 AI 结构化解析。而且 **stats.md 从未 push 到 GitHub**，AI 无法读取。

### 3.2 优化方案：stats.md 改为 Markdown + 嵌入 JSON

在文件顶部嵌入一个 JSON 块，AI 可以精确解析；下方保留人类可读的 Markdown 格式。

**新格式示例**：

```markdown
---
scan_status: "SUCCESS"
scan_date_utc: "2026-06-23T06:05:00Z"
duration_seconds: 7260
mnemonics_count: 2000
mnemonics_hash: "a1b2c3d4"
depth: 5
chains: ["ethereum", "solana"]
eth_tokens: ["USDT", "USDC"]
sol_tokens: ["USDT", "USDC"]
total_addresses_ethereum: 10000
total_addresses_solana: 10000
etherscan_calls: 20500
etherscan_calls_limit: 100000
etherscan_rate_percent: 20.5
notion_pages_written: 0
notion_failed: 0
errors: []
---

# Wallet Scanner Stats

## 运行状态
- **状态**: ✅ SUCCESS
- **运行时间 (UTC)**: 2026-06-23T06:05:00Z → 2026-06-23T08:05:00Z
- **耗时**: 2h 01m
- **代码版本**: `abc1234`

## 本次扫描配置
| 参数 | 值 |
|------|-----|
| 助记词数量 | 2,000 |
| 派生深度 | 5 |
| 链 | ethereum, solana |
| 查询代币 (ETH) | USDT, USDC |
| 查询代币 (SOL) | USDT, USDC |
| Etherscan 调用 | 20,500 / 100,000（20.5%） |

## 扫描结果
| 指标 | 值 |
|------|-----|
| 总派生地址 (ETH) | 10,000 |
| 总派生地址 (SOL) | 10,000 |
| 命中阈值地址 | 0 |
| Notion 写入 | 0 页 |
| 失败写入 | 0 |

## 错误
无
```

### 3.3 AI 读取优化要点

| 优化点 | 说明 |
|-------|------|
| **YAML front matter** | 文件顶部 `---` 包裹的 JSON/YAML，AI 可直接精确解析为字典 |
| **关键字段标准化** | `scan_status`, `duration_seconds`, `etherscan_calls` 等字段命名一致 |
| **百分比显示** | `etherscan_rate_percent: 20.5` 让 AI 快速了解额度消耗 |
| **错误列表** | `errors: []` 明确表示无错误，AI 不需要去 grep 关键词 |
| **Markdown 表格** | 保留人类可读的表格格式 |

### 3.4 新增：VPS 扫描结束后 push stats.md 到 GitHub

在 VPS 的 cron 任务中追加：

```bash
# cron 任务末尾追加
cd ${REPO_DIR}
git add wallet_scanner/stats.md
git diff --staged --quiet || \
  (git commit -m "Update stats - $(date -u +'%Y-%m-%d %H:%M:%S')" && git push)
```

这样 AI 就能从 GitHub 仓库直接读取 `wallet_scanner/stats.md`。

### 3.5 update-stats.sh 改动范围

`update-stats.sh` 需要：
1. 输出 YAML front matter（JSON 格式）到 stats.md 顶部
2. 更新 `tatum_*` 错误统计为 `etherscan_*` 相关
3. 其余 Markdown 结构保持不变

---

## 四、改动三：GitHub Actions 工作流优化

### 4.1 完整优化后的 workflow

```yaml
name: Generate Mnemonics

on:
  schedule:
    - cron: "0 22 * * *"
  workflow_dispatch:
    inputs:
      count:
        description: "助记词生成数量"
        required: false
        default: "2000"
        type: number

jobs:
  generate:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: main
          persist-credentials: false
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: pip install mnemonic

      - name: Generate mnemonics
        env:
          MNEMONICS_COUNT: ${{ github.event.inputs.count || vars.MNEMONICS_COUNT || 2000 }}
        run: python generate_mnemonics.py

      - name: Commit and push changes
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
        run: |
          git config --local user.email "github-actions[bot]@users.noreply.github.com"
          git config --local user.name "github-actions[bot]"
          git remote set-url origin https://x-access-token:${GH_TOKEN}@github.com/${{ github.repository }}
          git add mnemonics.txt
          git diff --staged --quiet || git commit -m "Update mnemonics - $(date +'%Y-%m-%d %H:%M:%S')"
          git push origin HEAD:main
```

### 4.2 与旧 workflow 对比

| 对比项 | 旧版 | 新版 |
|-------|------|------|
| 运行环境 | Node.js 20 (setup-node) | Python 3.11 (setup-python) |
| 依赖安装 | `npm ci` → 180+ 包, ~20s | `pip install mnemonic` → ~3s |
| 编译步骤 | `npm run build` (tsc) → ~5s | 无需编译 |
| 生成命令 | 硬编码 `100` | 环境变量 + workflow_dispatch 输入 |
| 手动触发 | 支持（但数量固定） | 支持（可指定数量） |
| 可配置性 | ❌ 需改 workflow 文件 | ✅ GitHub Variables 或手动输入 |

### 4.3 数量配置优先级

```
workflow_dispatch 手动输入  >  GitHub Variables(MNEMONICS_COUNT)  >  默认 2000
```

在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 中设置 `MNEMONICS_COUNT`，无需改代码即可调整数量。

---

## 五、完整 .env 文件

```bash
# ═══════════════════════════════════════════
# SeedScannooor 配置
# ═══════════════════════════════════════════

# ── 基础 API 密钥 ──
ETHERSCAN_API_KEY=YourApiKeyToken
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=xxxxx
NOTION_API_KEY=ntn_xxxxx
NOTION_DATABASE_ID=35808fc26c7380daba6fcfcd7fdccc0f

# ── 链开关 ──
CHAIN_ETHEREUM=1
CHAIN_SOLANA=1
# CHAIN_BSC=1
# CHAIN_POLYGON=1
# CHAIN_ARBITRUM=1
# CHAIN_BASE=1

# ── 扫描参数 ──
SCAN_DEPTH=5
THRESHOLD_USD=5.0

# ── Etherscan 参数 ──
ETHERSCAN_INTERVAL_MS=350

# 查询的代币合约（ETH）
ETH_TOKENS=USDT=0xdAC17F958D2ee523a2206206994597C13D831ec7,USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# ── Solana 参数 ──
MAX_CONCURRENT=1
SCAN_INTERVAL_MS=3000

# 查询的 SPL Token（Solana）
SOL_TOKENS=USDT=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB,USDC=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDg1v

# ── USD 价格查询 ──
COINGECKO_API_KEY=
```

---

## 六、完整改动清单

### 6.1 需改动的文件（8 个）

```
改动清单（按实施顺序）:

Step A — 生成助记词（今天就能改）
  1. generate_mnemonics.py     → 默认值 100→2000，支持 MNEMONICS_COUNT 环境变量
  2. .github/workflows/generate-mnemonics.yml → 切到 Python，改为可配置

Step B — 核心扫描引擎（EVM 替换 + 新配置）
  3. src/evm.ts                → 完全重写: Tatum → Etherscan V2 API
                                解析 ETH_TOKENS, ETHERSCAN_INTERVAL_MS
  4. src/config.ts             → 新增: ETHERSCAN_API_KEY, ETH_TOKENS, SOL_TOKENS
  5. src/mnemonic.ts           → deriveAddresses(chains, depth) 接受链参数
  6. src/solana.ts             → 解析 SOL_TOKENS 动态查询 SPL Token
  7. src/cli.ts                → 传递 cfg.chains / cfg.ethTokens / cfg.solTokens
                                结果即时持久化到 JSONL

Step C — Stats + AI 可读性
  8. wallet_scanner/update-stats.sh → 输出 YAML front matter + 推送到 GitHub
```

### 6.2 不需要改动的文件（9 个）

```
notion.ts, output.ts, types.ts, utils.ts, http.ts, filter.ts, resourceGuard.ts
vitest.config.ts, tsconfig.json

以及: 扫描器已动态读取 mnemonics.txt，不需要改读取逻辑
```

---

## 七、AI 读取 stats.md 的工作流程

### 7.1 stats.md 的完整生命周期

```
1. GitHub Actions (UTC 22:00)
   └─ 生成 2,000 条助记词 → mnemonics.txt

2. VPS Cron (Beijing 14:05)
   ├─ git pull → 拉取最新 mnemonics.txt
   ├─ 执行扫描
   ├─ update-stats.sh → 写入 stats.md（含 JSON front matter）
   ├─ 修改: git add stats.md → git commit → git push ✅【新增】

3. AI Agent (Beijing ~16:30)
   ├─ 读取 GitHub 仓库中的 wallet_scanner/stats.md
   ├─ 解析 YAML front matter:
   │   {
   │     "scan_status": "SUCCESS",
   │     "mnemonics_count": 2000,
   │     "etherscan_calls": 20500,
   │     "etherscan_rate_percent": 20.5,
   │     "errors": [],
   │     ...
   │   }
   └─ 根据结果判断是否需要通知或记录
```

### 7.2 AI 读取要点

AI 读取 stats.md 时应优先解析 YAML front matter，因为它的结构是精确的 JSON 格式，避免了从 Markdown 文本中 grep 关键词的歧义。

**AI 的 Prompt 设计参考**：

```
请读取 wallet_scanner/stats.md 中的 YAML front matter（文件顶部 --- 之间的内容），
检查 scan_status 是否为 SUCCESS，errors 列表是否为空，
etherscan_rate_percent 是否超过 80%（接近限流），
notion_pages_written 是否有数据。
```

---

## 八、总结

| 改动点 | 当前问题 | 优化方案 | 文件 |
|-------|---------|---------|------|
| 生成数量 | 硬编码 100 条 | 默认 2000，支持 `.env` / 环境变量 / CI 输入 | generate_mnemonics.py |
| CI 效率 | npm ci + build 太重 | 切到 Python，pip install 3 秒完成 | generate-mnemonics.yml |
| 余额查询 | Tatum 额度耗尽 | Etherscan V2 API，深度=5 | evm.ts |
| 代币查询 | 硬编码 USDT/USDC | ETH_TOKENS / SOL_TOKENS 环境变量配置 | evm.ts, solana.ts, config.ts |
| 派生浪费 | 固定派生 5 条 EVM 链 | 只派生实际启用的链 | mnemonic.ts, cli.ts |
| Stats 不可读 | 纯 Markdown，AI 难解析 | YAML front matter 嵌入 JSON | update-stats.sh |
| Stats 未推送 | 存在 VPS 本地，AI 读不到 | git push 到 GitHub | update-stats.sh |

---

*本方案围绕 2,000 条/天、SCAN_DEPTH=5 设计，覆盖 3 个方面：生成脚本调整、stats.md AI 友好化、GitHub Actions 优化。*
