#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOG_FILE="${LOG_FILE:-/var/log/wallet_scanner.log}"
MNEMONICS_FILE="${MNEMONICS_FILE:-${REPO_DIR}/mnemonics.txt}"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/results}"

RUN_ID="${RUN_ID:-${1:-}}"
EXIT_CODE="${EXIT_CODE:-}"

iso_now_utc() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
to_epoch() { date -u -d "$1" +%s 2>/dev/null || echo ""; }
is_iso_utc() { echo "${1:-}" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; }
fmt_dur() {
  local s="${1:-}" e="${2:-}"
  if [ -z "$s" ] || [ -z "$e" ]; then echo "-"; return; fi
  local ds de diff
  ds="$(to_epoch "$s")"; de="$(to_epoch "$e")"
  if [ -z "$ds" ] || [ -z "$de" ]; then echo "-"; return; fi
  diff=$((de - ds))
  if [ "$diff" -lt 0 ]; then diff=0; fi
  printf "%02d:%02d:%02d" $((diff/3600)) $(((diff%3600)/60)) $((diff%60))
}

env_get() {
  local k="$1"
  if [ -f "${SCRIPT_DIR}/.env" ]; then
    grep -E "^${k}=" "${SCRIPT_DIR}/.env" | tail -n 1 | cut -d= -f2- | tr -d '\r' || true
  fi
}

detect_chains() {
  local enabled=""
  for c in ethereum bsc polygon arbitrum base solana; do
    local k="CHAIN_$(echo "$c" | tr '[:lower:]' '[:upper:]')"
    local v
    v="$(env_get "$k")"
    v="$(echo "${v:-}" | tr '[:upper:]' '[:lower:]')"
    if [ "$v" = "1" ] || [ "$v" = "true" ] || [ "$v" = "yes" ] || [ "$v" = "on" ]; then
      enabled="${enabled}${enabled:+,}${c}"
    fi
  done
  if [ -n "$enabled" ]; then echo "$enabled"; else echo "ethereum,solana"; fi
}

detect_eth_tokens() {
  local v
  v="$(env_get "ETH_TOKENS")"
  if [ -n "$v" ]; then
    echo "$v" | awk -F'[,=]' '{for(i=1;i<=NF;i+=2) printf "%s ", $i}'
  else
    echo "USDT USDC"
  fi
}

detect_sol_tokens() {
  local v
  v="$(env_get "SOL_TOKENS")"
  if [ -n "$v" ]; then
    echo "$v" | awk -F'[,=]' '{for(i=1;i<=NF;i+=2) printf "%s ", $i}'
  else
    echo "USDT USDC"
  fi
}

tmp_run_block="$(mktemp)"
trap 'rm -f "${tmp_run_block}"' EXIT

if [ -f "${LOG_FILE}" ]; then
  if [ -n "${RUN_ID}" ]; then
    awk -v run_id="${RUN_ID}" '
      $0 ~ "^WALLET_SCANNER_RUN_START[[:space:]]+"run_id {inblock=1; buf=$0"\n"; next}
      inblock {buf=buf $0"\n"}
      $0 ~ "^WALLET_SCANNER_RUN_END[[:space:]]+"run_id {last=buf; inblock=0}
      END{
        if (last != "") {printf "%s", last; exit}
        if (buf != "") {printf "%s", buf; exit}
      }
    ' "${LOG_FILE}" > "${tmp_run_block}" || true
  else
    awk '
      /^WALLET_SCANNER_RUN_START/ {inblock=1; buf=$0"\n"; next}
      inblock {buf=buf $0"\n"}
      /^WALLET_SCANNER_RUN_END/ {last=buf; inblock=0}
      END{
        if (last != "") {printf "%s", last; exit}
        if (buf != "") {printf "%s", buf; exit}
      }
    ' "${LOG_FILE}" > "${tmp_run_block}" || true
  fi
fi

start_line="$(grep -E "^WALLET_SCANNER_RUN_START" "${tmp_run_block}" | head -n 1 || true)"
end_line="$(grep -E "^WALLET_SCANNER_RUN_END" "${tmp_run_block}" | tail -n 1 || true)"

run_id_from_log="$(echo "${start_line}" | awk '{print $2}' || true)"
start_candidate="$(echo "${start_line}" | awk '{print $3}' || true)"
end_candidate="$(echo "${end_line}" | awk '{print $3}' || true)"

if [ -z "${RUN_ID}" ] && [ -n "${run_id_from_log}" ]; then
  RUN_ID="${run_id_from_log}"
fi
if [ -z "${RUN_ID}" ]; then
  RUN_ID="$(iso_now_utc)"
fi

if is_iso_utc "${start_candidate}"; then start_utc="${start_candidate}"; else start_utc="${RUN_ID}"; fi
if is_iso_utc "${end_candidate}"; then end_utc="${end_candidate}"; else end_utc="${RUN_ID}"; fi

if [ -z "${EXIT_CODE}" ]; then
  EXIT_CODE="$(echo "${end_line}" | sed -n 's/.*exit_code=\([0-9]\+\).*/\1/p' || true)"
fi

status="RUNNING"
if [ -n "${EXIT_CODE}" ]; then
  if [ "${EXIT_CODE}" = "0" ]; then status="SUCCESS"; else status="FAILED"; fi
fi

duration="$(fmt_dur "${start_utc:-}" "${end_utc:-}")"

code_sha="-"
if command -v git >/dev/null 2>&1 && [ -d "${REPO_DIR}/.git" ]; then
  code_sha="$(cd "${REPO_DIR}" && git rev-parse --short HEAD 2>/dev/null || echo "-")"
fi

mn_lines="-"; mn_mtime="-"; mn_hash="-"
if [ -f "${MNEMONICS_FILE}" ]; then
  mn_lines="$(wc -l < "${MNEMONICS_FILE}" | tr -d ' ')"
  mn_mtime="$(date -u -r "${MNEMONICS_FILE}" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "-")"
  mn_hash="$(sha256sum "${MNEMONICS_FILE}" 2>/dev/null | awk '{print substr($1,1,8)}' || true)"
  if [ -z "${mn_hash}" ]; then mn_hash="-"; fi
fi

loaded_mnemonics="$(grep -E "Loaded [0-9]+ mnemonics" "${tmp_run_block}" | tail -n 1 | sed -n 's/Loaded \([0-9]\+\) mnemonics/\1/p' || true)"
if [ -z "${loaded_mnemonics}" ]; then loaded_mnemonics="-"; fi

total_scanned="$(grep -E "^Total mnemonics scanned:" "${tmp_run_block}" | tail -n 1 | awk '{print $4}' || true)"
if [ -z "${total_scanned}" ]; then total_scanned="-"; fi

passed_threshold="$(grep -E "^Passed threshold:" "${tmp_run_block}" | tail -n 1 | awk '{print $3}' || true)"
if [ -z "${passed_threshold}" ]; then passed_threshold="-"; fi

pass_rate="-"
if [ "${loaded_mnemonics}" != "-" ] && [ "${passed_threshold}" != "-" ] && [ "${loaded_mnemonics}" != "0" ]; then
  pass_rate="$(awk -v p="${passed_threshold}" -v t="${loaded_mnemonics}" 'BEGIN{printf "%.3f%%", (p/t)*100}')"
fi

jsonl_path="$(grep -E "^JSONL output:" "${tmp_run_block}" | tail -n 1 | sed -n 's/^JSONL output:[[:space:]]*//p' || true)"
csv_path="$(grep -E "^CSV output:" "${tmp_run_block}" | tail -n 1 | sed -n 's/^CSV output:[[:space:]]*//p' || true)"

if [ -z "${jsonl_path}" ] && [ -d "${OUTPUT_DIR}" ]; then
  jsonl_path="$(ls -1t "${OUTPUT_DIR}"/*_scan_results.jsonl 2>/dev/null | head -n 1 || true)"
fi
if [ -z "${csv_path}" ] && [ -d "${OUTPUT_DIR}" ]; then
  csv_path="$(ls -1t "${OUTPUT_DIR}"/*_scan_results.csv 2>/dev/null | head -n 1 || true)"
fi

if [ -n "${jsonl_path}" ]; then jsonl_path="${jsonl_path#${REPO_DIR}/}"; else jsonl_path="-"; fi
if [ -n "${csv_path}" ]; then csv_path="${csv_path#${REPO_DIR}/}"; else csv_path="-"; fi

notion_enabled="false"; notion_success="-"; notion_failed="-"
notion_line="$(grep -E "^Notion written:" "${tmp_run_block}" | tail -n 1 || true)"
if [ -n "${notion_line}" ]; then
  notion_enabled="true"
  notion_success="$(echo "${notion_line}" | sed -n 's/^Notion written: \([0-9]\+\) pages.*/\1/p' || true)"
  notion_failed="$(echo "${notion_line}" | sed -n 's/^Notion written: [0-9]\+ pages (\([0-9]\+\) failed).*/\1/p' || true)"
  if [ -z "${notion_success}" ]; then notion_success="-"; fi
  if [ -z "${notion_failed}" ]; then notion_failed="-"; fi
fi

error_unhandled="$(grep -E "Error:" "${tmp_run_block}" | tail -n 1 | sed -n 's/^.*Error:[[:space:]]*//p' || true)"
if [ -z "${error_unhandled}" ]; then error_unhandled="none"; fi

etherscan_400="$(grep -cE "status=400" "${tmp_run_block}" 2>/dev/null || true)"
timeout_cnt="$(grep -cE "AbortError|timeout" "${tmp_run_block}" 2>/dev/null || true)"
other_err="$(grep -cE "status=4[0-9]{2}|status=5[0-9]{2}" "${tmp_run_block}" 2>/dev/null || true)"

total_runs="0"
if [ -f "${LOG_FILE}" ]; then
  total_runs="$(grep -cE "^WALLET_SCANNER_RUN_END " "${LOG_FILE}" 2>/dev/null || echo "0")"
fi

last_success_run="$(grep -E "^WALLET_SCANNER_RUN_END .* exit_code=0" "${LOG_FILE}" | tail -n 1 || true)"
last_success_candidate="$(echo "${last_success_run}" | awk '{print $3}' || true)"
last_success_utc="$(echo "${last_success_run}" | awk '{print $2}' || true)"
if is_iso_utc "${last_success_candidate}"; then last_success_utc="${last_success_candidate}"; fi
if [ -z "${last_success_utc}" ]; then last_success_utc="-"; fi

depth="$(env_get SCAN_DEPTH)"; if [ -z "${depth}" ]; then depth="5"; fi
threshold="$(env_get THRESHOLD_USD)"; if [ -z "${threshold}" ]; then threshold="5.0"; fi
max_conc="$(env_get MAX_CONCURRENT)"; if [ -z "${max_conc}" ]; then max_conc="1"; fi
interval_ms="$(env_get SCAN_INTERVAL_MS)"; if [ -z "${interval_ms}" ]; then interval_ms="3000"; fi
etherscan_interval="$(env_get ETHERSCAN_INTERVAL_MS)"; if [ -z "${etherscan_interval}" ]; then etherscan_interval="350"; fi
chains="$(detect_chains)"
eth_tokens="$(detect_eth_tokens)"
sol_tokens="$(detect_sol_tokens)"

etherscan_total=$((loaded_mnemonics * depth * 2 + (loaded_mnemonics * depth + 19) / 20))
if [ "${etherscan_total}" -le 0 ] 2>/dev/null; then etherscan_total=0; fi

# Calculate duration in seconds for the front matter
duration_from_log=0
if [ -n "${start_utc}" ] && [ -n "${end_utc}" ] && [ "${start_utc}" != "-" ] && [ "${end_utc}" != "-" ]; then
  ds="$(to_epoch "${start_utc}")"
  de="$(to_epoch "${end_utc}")"
  if [ -n "${ds}" ] && [ -n "${de}" ]; then
    duration_from_log=$((de - ds))
    if [ "${duration_from_log}" -lt 0 ]; then duration_from_log=0; fi
  fi
fi

stats_path="${SCRIPT_DIR}/stats.md"
{
  # YAML front matter for AI parsing
  echo "---"
  echo "scan_status: \"${status}\""
  echo "scan_date_utc: \"${end_utc:-${start_utc:-${RUN_ID}}}\""
  echo "duration_seconds: ${duration_from_log}"
  echo "mnemonics_count: ${loaded_mnemonics}"
  echo "mnemonics_hash: \"${mn_hash}\""
  echo "depth: ${depth}"
  echo "chains: [${chains}]"
  echo "eth_tokens: [${eth_tokens}]"
  echo "sol_tokens: [${sol_tokens}]"
  echo "total_addresses_ethereum: $((loaded_mnemonics * depth))"
  echo "total_addresses_solana: $((loaded_mnemonics * depth))"
  echo "etherscan_calls: ${etherscan_total}"
  echo "etherscan_calls_limit: 100000"
  if [ "${etherscan_total}" -gt 0 ] 2>/dev/null; then
    echo "etherscan_rate_percent: $(awk -v e="${etherscan_total}" 'BEGIN{printf "%.1f", (e/100000)*100}')"
  else
    echo "etherscan_rate_percent: 0"
  fi
  echo "notion_pages_written: ${notion_success}"
  echo "notion_failed: ${notion_failed}"
  echo "passed_threshold: ${passed_threshold}"
  echo "errors: []"
  echo "---"
  echo
  echo "# Wallet Scanner Stats"
  echo
  echo "## Run Status"
  echo "- **Status**: ${status}"
  echo "- **Scan Time (UTC)**: ${end_utc:-${start_utc:-${RUN_ID}}}"
  echo "- **Duration**: ${duration}"
  echo "- **Code Version**: \`${code_sha}\`"
  echo
  echo "## Configuration"
  echo "| Parameter | Value |"
  echo "|----------|-------|"
  echo "| Mnemonics | ${loaded_mnemonics} |"
  echo "| Depth | ${depth} |"
  echo "| Chains | ${chains} |"
  echo "| ETH Tokens | ${eth_tokens} |"
  echo "| SOL Tokens | ${sol_tokens} |"
  echo "| Threshold (USD) | \$${threshold} |"
  echo "| Etherscan Interval | ${etherscan_interval}ms |"
  echo "| Solana Interval | ${interval_ms}ms |"
  echo "| Max Concurrent | ${max_conc} |"
  if [ "${etherscan_total}" -gt 0 ] 2>/dev/null; then
    echo "| Etherscan Usage | ${etherscan_total} / 100,000 ($(awk -v e="${etherscan_total}" 'BEGIN{printf "%.1f", (e/100000)*100}')%) |"
  fi
  echo
  echo "## Results"
  echo "| Metric | Value |"
  echo "|-------|-------|"
  echo "| Derived Addresses (ETH) | $((loaded_mnemonics * depth)) |"
  echo "| Derived Addresses (SOL) | $((loaded_mnemonics * depth)) |"
  echo "| Passed Threshold | ${passed_threshold} |"
  echo "| Pass Rate | ${pass_rate} |"
  echo "| Notion Written | ${notion_success} pages |"
  echo "| Notion Failed | ${notion_failed} |"
  echo
  echo "## Output Files"
  echo "- JSONL: \`${jsonl_path}\`"
  echo "- CSV: \`${csv_path}\`"
  echo
  if [ "${error_unhandled}" != "none" ]; then
    echo "## Errors"
    echo "- Unhandled: ${error_unhandled}"
  fi
  echo "## Etherscan Errors"
  echo "- HTTP 400: ${etherscan_400}"
  echo "- Timeout: ${timeout_cnt}"
  echo "- Other: ${other_err}"
} > "${stats_path}"

# Push stats.md to GitHub
if command -v git >/dev/null 2>&1 && [ -d "${REPO_DIR}/.git" ]; then
  cd "${REPO_DIR}"
  git add wallet_scanner/stats.md 2>/dev/null || true
  git diff --staged --quiet 2>/dev/null || \
    (git commit -m "Update stats - $(date -u +'%Y-%m-%d %H:%M:%S')" && git push) 2>/dev/null || true
fi
