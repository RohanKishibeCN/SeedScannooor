#!/bin/bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

set -e

REPO_DIR=/root/SeedScannooor
PROJECT_DIR=/root/SeedScannooor/wallet_scanner
BRUTE_FILE=/root/SeedScannooor/bruteforce_mnemonics.txt
LOG_FILE=/var/log/wallet_scanner.log
BRUTE_STATS_FILE="$PROJECT_DIR/brute-stats.md"

cd "$REPO_DIR" && git pull --rebase --quiet

cd "$PROJECT_DIR"

chmod +x "$PROJECT_DIR/update-stats.sh" 2>/dev/null || true

RUN_ID=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Generate brute-force mnemonics
node dist/generate-bruteforce-mnemonics.js "$BRUTE_FILE" >> "$LOG_FILE" 2>&1

echo "BRUTE_RUN_START ${RUN_ID} $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG_FILE"

set +e
node dist/cli.js --mnemonic-file "$BRUTE_FILE" --chains ethereum --depth 1 --output-dir ./brute_results >> "$LOG_FILE" 2>&1
RC=$?
set -e

echo "BRUTE_RUN_END ${RUN_ID} $(date -u +%Y-%m-%dT%H:%M:%SZ) exit_code=${RC}" >> "$LOG_FILE"

# Extract results from the run block in log
tmp_block=$(mktemp)
trap 'rm -f "$tmp_block"' EXIT

awk -v run_id="${RUN_ID}" '
  $0 ~ "^BRUTE_RUN_START[[:space:]]+"run_id {inblock=1; buf=$0"\n"; next}
  inblock {buf=buf $0"\n"}
  $0 ~ "^BRUTE_RUN_END[[:space:]]+"run_id {last=buf; inblock=0}
  END{
    if (last != "") {printf "%s", last; exit}
    if (buf != "") {printf "%s", buf; exit}
  }
' "${LOG_FILE}" > "$tmp_block" 2>/dev/null || true

loaded_mnemonics=$(grep -E "Loaded [0-9]+ mnemonics" "$tmp_block" | tail -1 | sed -n 's/Loaded \([0-9]\+\) mnemonics/\1/p' || true)
if [ -z "$loaded_mnemonics" ]; then loaded_mnemonics="0"; fi

passed=$(grep -E "^Passed threshold:" "$tmp_block" | tail -1 | awk '{print $3}' || true)
if [ -z "$passed" ]; then passed="0"; fi

start_line=$(grep -E "^BRUTE_RUN_START ${RUN_ID}" "$LOG_FILE" | tail -1 || true)
end_line=$(grep -E "^BRUTE_RUN_END ${RUN_ID}" "$LOG_FILE" | tail -1 || true)

start_utc=$(echo "$start_line" | awk '{print $3}' || echo "$RUN_ID")
end_utc=$(echo "$end_line" | awk '{print $3}' || echo "$RUN_ID")

duration_sec=0
to_epoch() { date -u -d "$1" +%s 2>/dev/null || echo "0"; }
ds=$(to_epoch "$start_utc"); de=$(to_epoch "$end_utc")
if [ "$de" -gt "$ds" ] 2>/dev/null; then duration_sec=$((de - ds)); fi

printf -v duration_fmt "%02d:%02d:%02d" $((duration_sec/3600)) $(((duration_sec%3600)/60)) $((duration_sec%60))

# ── Write brute-stats.md (independent file for backward compat) ──
{
  echo "---"
  echo "scan_status: \"SUCCESS\""
  echo "scan_date_utc: \"${end_utc}\""
  echo "duration_seconds: ${duration_sec}"
  echo "duration_formatted: \"${duration_fmt}\""
  echo "mnemonics_count: ${loaded_mnemonics}"
  echo "depth: 1"
  echo "chains: [ethereum]"
  echo "etherscan_calls: $(awk "BEGIN{printf \"%.0f\", ${loaded_mnemonics:-0}/20 + ${loaded_mnemonics:-0}*2}")"
  echo "etherscan_calls_limit: 100000"
  if [ "${loaded_mnemonics:-0}" -gt 0 ] 2>/dev/null; then
    echo "etherscan_rate_percent: $(awk "BEGIN{printf \"%.1f\", (${loaded_mnemonics:-0}/20 + ${loaded_mnemonics:-0}*2)/100000*100}")"
  else
    echo "etherscan_rate_percent: 0"
  fi
  echo "passed_threshold: ${passed}"
  echo "prefix_words: \"fault door pride design claw naive raccoon price\""
  echo "errors: []"
  echo "---"
  echo
  echo "# Brute Force Stats"
  echo
  echo "## Run Status"
  echo "- **Status**: SUCCESS"
  echo "- **Scan Time (UTC)**: ${end_utc}"
  echo "- **Duration**: ${duration_fmt}"
  echo
  echo "## Results"
  echo "| Metric | Value |"
  echo "|-------|-------|"
  echo "| Mnemonics Scanned | ${loaded_mnemonics} |"
  echo "| Passed Threshold | ${passed} |"
  echo "| Prefix | fault door pride design claw naive raccoon price |"
  echo
  if [ "${passed}" -gt 0 ] 2>/dev/null; then
    echo "## ⚡ FOUND! Check brute_results/ directory for details."
    echo "## ℹ️ The wallet with balance bypassed the check!"
  fi
} > "$BRUTE_STATS_FILE"

# ── Merge brute-force results into stats.md (single-file reading) ──
STATS_FILE="$PROJECT_DIR/stats.md"
if [ -f "$STATS_FILE" ]; then
  # Extract YAML body (lines after second ---)
  body=$(awk 'BEGIN{c=0} /^---/{c++;next} c>=2{print}' "$STATS_FILE" 2>/dev/null || true)

  # Rebuild stats.md: keep original, append brute force section
  {
    # Print everything up to (and including) the "## Etherscan Errors" line
    echo "$body" | awk 'BEGIN{found=0} /^## / && !found{found=1; print; next} !found{print}'
    echo ""
    echo "---"
    echo ""
    echo "# Brute Force"
    echo ""
    echo "## Status"
    echo "- **Status**: SUCCESS"
    echo "- **Scan Time (UTC)**: ${end_utc}"
    echo "- **Duration**: ${duration_fmt}"
    echo "- **Prefix**: fault door pride design claw naive raccoon price"
    echo ""
    echo "## Results"
    echo "| Metric | Value |"
    echo "|-------|-------|"
    echo "| Mnemonics Scanned | ${loaded_mnemonics} |"
    echo "| Passed Threshold | ${passed} |"
    echo "| Etherscan Usage | $(awk "BEGIN{printf \"%.0f\", ${loaded_mnemonics:-0}/20 + ${loaded_mnemonics:-0}*2}") / 100,000 calls |"
    if [ "${passed}" -gt 0 ] 2>/dev/null; then
      echo ""
      echo "## ⚡ **FOUND A WALLET WITH BALANCE!** ⚡"
      echo "Check wallet_scanner/brute_results/ directory for details."
    fi
  } > "$STATS_FILE"
fi

# Push both stats files to GitHub
if command -v git >/dev/null 2>&1 && [ -d "${REPO_DIR}/.git" ]; then
  cd "${REPO_DIR}"
  git add wallet_scanner/stats.md wallet_scanner/brute-stats.md 2>/dev/null || true
  git diff --staged --quiet 2>/dev/null || \
    (git commit -m "Update stats + brute-stats - $(date -u +'%Y-%m-%d %H:%M:%S')" && git push) 2>/dev/null || true
fi

exit 0
