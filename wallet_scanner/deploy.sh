#!/bin/bash
#
# VPS 部署脚本 - 钱包扫描器 + 每日自动调度
# 用法: bash deploy.sh
#
set -e

echo "======================================"
echo "  Wallet Scanner 部署脚本"
echo "======================================"

# --- 1. 检测并安装依赖 ---
echo "[1/7] 检查系统依赖..."
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
else
    echo "错误: 未找到 Python，请先安装 Python 3.11+"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
echo "  Python 版本: $PYTHON_VERSION"

if ! command -v git &>/dev/null; then
    echo "  安装 git..."
    apt-get update && apt-get install -y git
fi

if ! command -v gh &>/dev/null; then
    echo "  安装 GitHub CLI..."
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    apt-get update && apt-get install -y gh
fi

# --- 2. 克隆/更新仓库 ---
echo "[2/7] 克隆助记词仓库..."
REPO_DIR="/opt/seed_scanner_repo"
GH_USER="RohanKishibeCN"
GH_REPO="SeedScannooor"

if [ -d "$REPO_DIR" ]; then
    echo "  仓库已存在，拉取最新..."
    cd "$REPO_DIR" && git pull
else
    echo "  克隆私有仓库到 $REPO_DIR ..."
    gh auth login --hostname github.com
    gh repo clone "$GH_USER/$GH_REPO" "$REPO_DIR"
fi

MNEMONIC_FILE="$REPO_DIR/mnemonics.txt"
if [ ! -f "$MNEMONIC_FILE" ]; then
    echo "错误: 助记词文件不存在: $MNEMONIC_FILE"
    exit 1
fi

chmod 600 "$MNEMONIC_FILE"
chmod -R 700 "$REPO_DIR"
echo "  助记词文件权限已设置为 600"

# --- 3. 安装项目依赖 ---
echo "[3/7] 安装 Python 依赖..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$SCRIPT_DIR}"
cd "$PROJECT_DIR"

if [ ! -d "venv" ]; then
    echo "  创建虚拟环境..."
    $PYTHON_CMD -m venv venv
fi

source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# --- 4. 配置 .env ---
echo "[4/7] 配置环境变量..."
ENV_FILE="$PROJECT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    cp .env.example "$ENV_FILE"
    echo ""
    echo "=========================================="
    echo "!! 请编辑 $ENV_FILE 填入以下配置 !!"
    echo "=========================================="
    echo ""
    echo "【必需】API 密钥："
    echo "  MORALIS_API_KEY      # EVM 聚合余额（https://moralis.io/）"
    echo "  HELIUS_RPC_URL      # Solana RPC（https://helius.xyz/）"
    echo "  NOTION_API_KEY, NOTION_DATABASE_ID"
    echo ""
    echo "【可选】扫描参数（不填则用默认值）："
    echo "  SCAN_DEPTH=10        # 每条助记词派生多少个地址"
    echo "  THRESHOLD_USD=10.0   # 余额阈值（USD），>= 此值才写 Notion"
    echo ""
    echo "按回车继续（配置完成后）..."
    read -r
fi

# --- 5. 测试运行 ---
echo "[5/7] 测试运行（2 条助记词 x 2 个地址）..."
$PYTHON_CMD main.py \
    --mnemonic-file "$MNEMONIC_FILE" \
    --chains ethereum,solana \
    --depth 2 \
    --output-dir ./results_test \
    && echo "  测试运行成功！" \
    || { echo "  测试运行失败，请检查配置"; exit 1; }

# --- 6. 配置每日调度（北京时间 14:00 = UTC 06:00）---
echo "[6/7] 配置每日调度任务..."
CRON_FILE="/etc/cron.d/wallet_scanner"

cat > "$CRON_FILE" << 'CRONEOF'
# Wallet Scanner 每日自动扫描
# 北京时间 14:05 = UTC 06:05
# 每次执行前自动拉取最新助记词文件（git pull）
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
5 6 * * * root \
  cd /opt/seed_scanner_repo && git pull --quiet && \
  cd PROJECT_DIR_PLACEHOLDER && . venv/bin/activate && \
  PYTHON_CMD_PLACEHOLDER main.py --mnemonic-file /opt/seed_scanner_repo/mnemonics.txt \
  >> /var/log/wallet_scanner.log 2>&1
CRONEOF

sed -i "s|PROJECT_DIR_PLACEHOLDER|$PROJECT_DIR|g" "$CRON_FILE"
sed -i "s|PYTHON_CMD_PLACEHOLDER|$PYTHON_CMD|g" "$CRON_FILE"
chmod 644 "$CRON_FILE"
echo "  已添加 cron 任务: 每天 UTC 06:05 = 北京时间 14:05"
echo "  每次执行前自动 git pull 拉取最新助记词"

# --- 7. 验证 ---
echo "[7/7] 部署验证..."
echo "  .env 文件:       $([ -f "$ENV_FILE" ] && echo '✅ 存在' || echo '❌ 缺失')"
echo "  助记词文件:     $([ -f "$MNEMONIC_FILE" ] && echo '✅ 存在' || echo '❌ 缺失')"
echo "  cron 任务:      ✅ 已添加"

echo ""
echo "======================================"
echo "  部署完成！"
echo "======================================"
echo ""
echo "  ⏰ 调度时间: 每天北京时间 14:05"
echo "  📄 日志:     /var/log/wallet_scanner.log"
echo "  📁 输出:     $PROJECT_DIR/results/"
echo "  📝 失败重试: $PROJECT_DIR/failed_notion_writes.jsonl"
echo ""
echo "  📌 可调参数（在 .env 中修改，次日生效）："
echo "     SCAN_DEPTH=20      # 每条助记词派生的地址数量"
echo "     THRESHOLD_USD=10.0 # 余额阈值（USD）"
echo ""
echo "  查看日志: tail -f /var/log/wallet_scanner.log"
echo "  手动运行: cd $PROJECT_DIR && source venv/bin/activate && python main.py --mnemonic-file $MNEMONIC_FILE"
