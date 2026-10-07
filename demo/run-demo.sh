#!/usr/bin/env bash
# Starts the mock Fiber API in the background and opens Sailor against it in a clean, throwaway sandbox.
# Usage: ./demo/run-demo.sh            (mock mode — zero real credits, deterministic data)
#        LIVE=1 ./demo/run-demo.sh     (live Fiber API — uses your real key and real credits)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${SANDBOX:-/tmp/sailor-demo}"

if [[ "${FRESH:-1}" == "1" ]]; then rm -rf "$SANDBOX"; fi
mkdir -p "$SANDBOX"
export SAILOR_HOME="$SANDBOX" SAILOR_DB="$SANDBOX/sailor.db" SAILOR_DISABLE_KEYCHAIN=1

if [[ "${LIVE:-0}" != "1" ]]; then
  "$ROOT/node_modules/.bin/tsx" "$ROOT/evals/mock-fiber-server.ts" >"$SANDBOX/mock.log" 2>&1 &
  MOCK_PID=$!
  trap 'kill $MOCK_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:4455/v1/rate-limits -X POST && break; sleep 0.25; done
  export FIBER_BASE_URL=http://127.0.0.1:4455 FIBER_MCP_BASE_URL=http://127.0.0.1:4455
  export FIBER_API_KEY=sk_live_testkey123456 SAILOR_ALLOW_INSECURE_URLS=1
fi

cd "$ROOT/demo/workspace"
clear
node "$ROOT/packages/sailor-cli/bin/sailor.mjs" "$@"
