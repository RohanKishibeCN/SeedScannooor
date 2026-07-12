#!/bin/bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

set -e

REPO_DIR=/root/SeedScannooor
PROJECT_DIR=/root/SeedScannooor/wallet_scanner
MNEMONIC_FILE=/root/SeedScannooor/mnemonics.txt
LOG_FILE=/var/log/wallet_scanner.log

cd "$REPO_DIR" && git pull --rebase --quiet

cd "$PROJECT_DIR"
npm ci --no-audit --no-fund >/dev/null 2>&1
npm run build >/dev/null 2>&1

chmod +x "$PROJECT_DIR/update-stats.sh" 2>/dev/null || true

RUN_ID=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "WALLET_SCANNER_RUN_START ${RUN_ID} $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG_FILE"

set +e
node dist/cli.js --mnemonic-file "$MNEMONIC_FILE" >> "$LOG_FILE" 2>&1
RC=$?
set -e

echo "WALLET_SCANNER_RUN_END ${RUN_ID} $(date -u +%Y-%m-%dT%H:%M:%SZ) exit_code=${RC}" >> "$LOG_FILE"

LOG_FILE="$LOG_FILE" MNEMONICS_FILE="$MNEMONIC_FILE" "$PROJECT_DIR/update-stats.sh" "$RUN_ID" >> "$LOG_FILE" 2>&1

exit 0
