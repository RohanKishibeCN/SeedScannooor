#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOG_FILE="${LOG_FILE:-/var/log/wallet_scanner.log}"
MNEMONICS_FILE="${MNEMONICS_FILE:-${REPO_DIR}/mnemonics.txt}"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/results}"
FAILED_NOTION_LOG="${FAILED_NOTION_LOG:-${SCRIPT_DIR}/failed_notion_writes.jsonl}"

RUN_ID="${1:-}"

iso_now_utc() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
to_epoch() { date -u -d "$1" +%s 2>/dev/null || echo ""; }
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

yaml_get() {
  local k="$1"
  if [ -f "${SCRIPT_DIR}/config.yaml" ]; then
    awk -v key="${k}" -F':' '
      $1 ~ "^[[:space:]]*"key"[[:space:]]*$" {
        sub(/^[[:space:]]+/, "", $2);
        sub(/[[:space:]]+$/, "", $2);
        gsub(/^"|"$/, "", $2);
        print $2; exit
      }
    ' "${SCRIPT_DIR}/config.yaml" || true
  fi
}

detect_chains() {
  local enabled=""
  for c in ethereum bsc polygon arbitrum base solana; do
    local v
    v="$(env_get "CHAIN_$(echo "$c" | tr '[:lower:]' '[:upper:]')")"
    v="$(echo "${v:-}" | tr '[:upper:]' '[:lower:]')"
    if [ "$v" = "1" ] || [ "$v" = "true" ] || [ "$v" = "yes" ] || [ "$v" = "on" ]; then
      enabled="${enabled}${enabled:+,}${c}"
    fi
  done
  if [ -n "$enabled" ]; then
    echo "$enabled"
  else
    echo "ethereum,solana"
  fi
}

if [ -z "${RUN_ID}" ] && [ -f "${LOG_FILE}" ]; then
  RUN_ID="$(grep -E "^WALLET_SCANNER_RUN_START " "${LOG_FILE}" | tail -n 1 | awk '{print $2}' || true)"
fi
if [ -z "${RUN_ID}" ]; then
  RUN_ID="$(iso_now_utc)"
fi

tmp_run_block="$(mktemp)"
trap 'rm -f "${tmp_run_block}"' EXIT

if [ -f "${LOG_FILE}" ]; then
  awk -v run_id="${RUN_ID}" '
    $0 ~ "^WALLET_SCANNER_RUN_START "run_id {inblock=1}
    inblock {print}
    $0 ~ "^WALLET_SCANNER_RUN_END "run_id {exit}
  ' "${LOG_FILE}" > "${tmp_run_block}" || true
fi

start_line="$(grep -E "^WALLET_SCANNER_RUN_START ${RUN_ID} " "${tmp_run_block}" | tail -n 1 || true)"
end_line="$(grep -E "^WALLET_SCANNER_RUN_END ${RUN_ID} " "${tmp_run_block}" | tail -n 1 || true)"

start_utc="$(echo "${start_line}" | awk '{print $3}' || true)"
end_utc="$(echo "${end_line}" | awk '{print $3}' || true)"
exit_code="$(echo "${end_line}" | sed -n 's/.*exit_code=$[0-9]\+$.*/\1/p' || true)"

status="RUNNING"
if [ -n "${exit_code}" ]; then
  if [ "${exit_code}" = "0" ]; then status="SUCCESS"; else status="FAILED"; fi
fi

duration="$(fmt_dur "${start_utc:-}" "${end_utc:-}")"

code_sha="-"
if command -v git >/dev/null 2>&1 && [ -d "${REPO_DIR}/.git" ]; then
  code_sha="$(cd "${REPO_DIR}" && git rev-parse --short HEAD 2>/dev/null || echo "-")"
fi

mn_lines="-"
mn_mtime="-"
mn_hash="-"
if [ -f "${MNEMONICS_FILE}" ]; then
  mn_lines="$(wc -l < "${MNEMONICS_FILE}" | tr -d ' ')"
  mn_mtime="$(date -u -r "${MNEMONICS_FILE}" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "-")"
  mn_hash="$(sha256sum "${MNEMONICS_FILE}" 2>/dev/null | awk '{print substr($1,1,8)}' || true)"
  if [ -z "${mn_hash}" ]; then mn_hash="-"; fi
fi

loaded_mnemonics="$(grep -E "加载了 [0-9]+ 条助记词" "${tmp_run_block}" | tail -n 1 | sed -n 's/加载了 $[0-9]\+$ 条助记词/\1/p' || true)"
if [ -z "${loaded_mnemonics}" ]; then loaded_mnemonics="-"; fi

total_scanned="$(grep -E "^Total scanned:" "${tmp_run_block}" | tail -n 1 | awk '{print $3}' || true)"
if [ -z "${total_scanned}" ]; then total_scanned="-"; fi

passed_threshold="$(grep -E "^Passed threshold:" "${tmp_run_block}" | tail -n 1 | awk '{print $3}' || true)"
if [ -z "${passed_threshold}" ]; then passed_threshold="-"; fi

pass_rate="-"
if [ "${loaded_mnemonics}" != "-" ] && [ "${passed_threshold}" != "-" ] && [ "${loaded_mnemonics}" != "0" ]; then
  pass_rate="$(awk -v p="${passed_threshold}" -v t="${loaded_mnemonics}" 'BEGIN{printf "%.3f%%", (p/t)*100}')"
fi

json_path="$(grep -E "^JSON output:" "${tmp_run_block}" | tail -n 1 | sed -n 's/^JSON output:[[:space:]]*//p' || true)"
csv_path="$(grep -E "^CSV output:" "${tmp_run_block}" | tail -n 1 | sed -n 's/^CSV output:[[:space:]]*//p' || true)"

if [ -z "${json_path}" ] && [ -d "${OUTPUT_DIR}" ]; then
  json_path="$(ls -1t "${OUTPUT_DIR}"/*_scan_results.json 2>/dev/null | head -n 1 || true)"
fi
if [ -z "${csv_path}" ] && [ -d "${OUTPUT_DIR}" ]; then
  csv_path="$(ls -1t "${OUTPUT_DIR}"/*_scan_results.csv 2>/dev/null | head -n 1 || true)"
fi

if [ -n "${json_path}" ]; then json_path="${json_path#${REPO_DIR}/}"; else json_path="-"; fi
if [ -n "${csv_path}" ]; then csv_path="${csv_path#${REPO_DIR}/}"; else csv_path="-"; fi

notion_enabled="false"
notion_success="-"
notion_failed="-"
notion_line="$(grep -E "^Notion written:" "${tmp_run_block}" | tail -n 1 || true)"
if [ -n "${notion_line}" ]; then
  notion_enabled="true"
  notion_success="$(echo "${notion_line}" | sed -n 's/^Notion written: $[0-9]\+$ pages.*/\1/p' || true)"
  notion_failed="$(echo "${notion_line}" | sed -n 's/^Notion written: [0-9]\+ pages ($[0-9]\+$ failed).*/\1/p' || true)"
  if [ -z "${notion_success}" ]; then notion_success="-"; fi
  if [ -z "${notion_failed}" ]; then notion_failed="-"; fi
fi

error_unhandled="$(grep -E "发生错误:" "${tmp_run_block}" | tail -n 1 | sed -n 's/^.*发生错误:[[:space:]]*//p' || true)"
if [ -z "${error_unhandled}" ]; then error_unhandled="none"; fi

tatum_400="$(grep -cE "HTTP 400" "${tmp_run_block}" 2>/dev/null || true)"
rate_limited="$(grep -cE "rate limited" "${tmp_run_block}" 2>/dev/null || true)"
timeout_cnt="$(grep -cE "AbortError|timeout" "${tmp_run_block}" 2>/dev/null || true)"
other_err="$(grep -cE "HTTP [45][0-9]{2}" "${tmp_run_block}" 2>/dev/null || true)"

total_runs="0"
if [ -f "${LOG_FILE}" ]; then
  total_runs="$(grep -cE "^WALLET_SCANNER_RUN_END " "${LOG_FILE}" 2>/dev/null || echo "0")"
fi

last_success_run="$(grep -E "^WALLET_SCANNER_RUN_END .* exit_code=0" "${LOG_FILE}" | tail -n 1 || true)"
last_success_utc="$(echo "${last_success_run}" | awk '{print $3}' || true)"
if [ -z "${last_success_utc}" ]; then last_success_utc="-"; fi

depth="$(env_get SCAN_DEPTH)"; if [ -z "${depth}" ]; then depth="$(yaml_get depth)"; fi; if [ -z "${depth}" ]; then depth="20"; fi
threshold="$(env_get THRESHOLD_USD)"; if [ -z "${threshold}" ]; then threshold="$(yaml_get threshold_usd)"; fi; if [ -z "${threshold}" ]; then threshold="10.0"; fi
max_conc="$(env_get MAX_CONCURRENT)"; if [ -z "${max_conc}" ]; then max_conc="$(yaml_get max_concurrent)"; fi; if [ -z "${max_conc}" ]; then max_conc="10"; fi
interval_ms="$(env_get SCAN_INTERVAL_MS)"; if [ -z "${interval_ms}" ]; then interval_ms="$(yaml_get scan_interval_ms)"; fi; if [ -z "${interval_ms}" ]; then interval_ms="100"; fi
chains="$(detect_chains)"

stats_path="${SCRIPT_DIR}/stats.md"
{
  echo "# Wallet Scanner Stats"
  echo
  echo "## Overview"
  echo "- Status: ${status}"
  echo "- Last Run (UTC): ${end_utc:-${start_utc:-${RUN_ID}}}"
  echo "- Last Success (UTC): ${last_success_utc}"
  echo "- Duration: ${duration}"
  echo "- Code Version: ${code_sha}"
  echo "- Mnemonics File: lines=${mn_lines}, mtime=${mn_mtime}, hash=${mn_hash}"
  echo
  echo "## This Run"
  echo "- Run ID: ${RUN_ID}"
  echo "- Config: chains=${chains}; depth=${depth}; threshold_usd=${threshold}; max_concurrent=${max_conc}; interval_ms=${interval_ms}"
  echo "- Progress: total_lines=${loaded_mnemonics}; processed_lines=${loaded_mnemonics}; passed=${passed_threshold}; pass_rate=${pass_rate}"
  echo "- Outputs: json=${json_path}; csv=${csv_path}"
  echo "- Notion: enabled=${notion_enabled}; success=${notion_success}; failed=${notion_failed}; failed_log=failed_notion_writes.jsonl"
  echo
  echo "## Errors (This Run)"
  echo "- Tatum: http_400=${tatum_400}; rate_limited=${rate_limited}; timeout=${timeout_cnt}; other=${other_err}"
  echo "- Unhandled Exception: ${error_unhandled}"
  echo
  echo "## Cumulative"
  echo "- Total Runs: ${total_runs}"
} > "${stats_path}"

exit 0
