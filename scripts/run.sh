#!/usr/bin/env bash
# redact-lint action entry point.
#
# Selects the PDFs, runs the scanner, writes a job summary, publishes outputs
# and fails the step when a leak is found (unless fail-on: never).
set -uo pipefail

root="${GITHUB_ACTION_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
work="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
files="$work/redact-lint-files.txt"
report="$work/redact-lint-report.json"
mkdir -p "$work"

version="${INPUT_VERSION:-latest}"
coverage="${INPUT_MIN_COVERAGE:-0.6}"
fail_on="${INPUT_FAIL_ON:-leak}"

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"
  fi
  return 0
}

# shellcheck disable=SC2317
out() {
  local key="$1" value="$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  else
    printf '%s=%s\n' "$key" "$value"
  fi
}

node "$root/scripts/changed-pdfs.mjs" > "$files" || exit 2
count=$(grep -c . "$files" || true)

if [ "$count" -eq 0 ]; then
  echo "redact-lint: no PDFs to scan"
  summary "### redact-lint" "" "No PDFs to scan." ""
  out leaks 0
  out files 0
  out report ""
  exit 0
fi

echo "redact-lint: scanning $count PDF(s)"
# Read without mapfile: macOS ships bash 3.2, which has no mapfile.
list=()
while IFS= read -r line; do
  [ -n "$line" ] && list+=("$line")
done < "$files"

args=(--json --min-coverage "$coverage")
if [ "${INPUT_SHOW_TEXT:-false}" = "true" ]; then
  args+=(--show-text)
fi
if [ -n "${INPUT_IGNORE_FILE:-}" ]; then
  args+=(--ignore-file "$INPUT_IGNORE_FILE")
fi

# Install into a private prefix and call the entry point with node. `npx`
# depends on a bin symlink and PATH, which differs across runners and npm
# versions; this path is the same everywhere.
#
# RL_CLI points at a local checkout of src/cli.mjs; used by this repo's own
# tests so they never depend on the network.
status=0
if [ -n "${RL_CLI:-}" ]; then
  node "$RL_CLI" "${args[@]}" "${list[@]}" > "$report" || status=$?
else
  prefix="$work/redact-lint-pkg"
  if ! npm install --prefix "$prefix" --no-audit --no-fund --loglevel=error "redact-lint@$version" >/dev/null 2>&1; then
    echo "::error::could not install redact-lint@$version"
    exit 2
  fi
  node "$prefix/node_modules/redact-lint/src/cli.mjs" "${args[@]}" "${list[@]}" > "$report" || status=$?
fi

if [ ! -s "$report" ]; then
  echo "::error::redact-lint produced no report (exit $status)"
  summary "### redact-lint" "" "The scanner did not produce a report. See the job log."
  out leaks ""
  out files "$count"
  out report ""
  exit 2
fi

node "$root/scripts/report.mjs" "$report" "$files" || true

leaks=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).leaks))" "$report")

out leaks "$leaks"
out files "$count"
out report "$report"

if [ "$status" -eq 2 ]; then
  echo "::error::redact-lint could not read one or more PDFs"
  exit 2
fi

if [ "$leaks" -gt 0 ] && [ "$fail_on" != "never" ]; then
  echo "::error::$leaks redacted region(s) still contain extractable text. The covered content must be removed, not painted over."
  exit 1
fi

if [ "$leaks" -gt 0 ]; then
  echo "::warning::$leaks redacted region(s) still contain extractable text (fail-on: never)"
fi

exit 0
