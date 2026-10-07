#!/usr/bin/env bash
# One-command Sailor demo on a Fiber SANDBOX key (sk_test_…): checks, setup, probe, launch.
# Usage (from anywhere):  ~/Projects/Sailor_Agent_Harness/demo/sandbox-demo.sh
#   SKIP_TESTS=1  skip npm test      SKIP_PROBE=1  skip the sandbox endpoint probe
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
G='\033[32m'; Y='\033[33m'; R='\033[31m'; B='\033[1m'; N='\033[0m'
step() { printf "\n${B}▶ %s${N}\n" "$1"; }
ok()   { printf "${G}✓ %s${N}\n" "$1"; }
warn() { printf "${Y}! %s${N}\n" "$1"; }
die()  { printf "${R}✗ %s${N}\n" "$1"; exit 1; }

step "1/6 Node.js"
command -v node >/dev/null || die "Node is not installed. Install Node 22.13+ (brew install node@22) and re-run."
NODE_OK=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=13)?1:0)')
[[ "$NODE_OK" == 1 ]] || die "Node $(node -v) is too old; Sailor needs 22.13+."
ok "Node $(node -v)"

step "2/6 Dependencies"
if [[ ! -x node_modules/.bin/pi || ! -x node_modules/.bin/tsx ]]; then npm install; fi
ok "Pi $(node_modules/.bin/pi --version 2>/dev/null | head -1) (local copy in node_modules)"

step "3/6 Tests"
if [[ "${SKIP_TESTS:-0}" == 1 ]]; then warn "skipped (SKIP_TESTS=1)"; else npm test --silent >/tmp/sailor-tests.log 2>&1 && ok "$(grep -E '^ℹ pass' /tmp/sailor-tests.log | sed 's/ℹ //') tests passing" || { tail -30 /tmp/sailor-tests.log; die "Tests failed (full log: /tmp/sailor-tests.log)"; }; fi

step "4/6 Clean environment"
unset FIBER_BASE_URL FIBER_MCP_BASE_URL SAILOR_ALLOW_INSECURE_URLS SAILOR_DRY_RUN SAILOR_HOME SAILOR_DB
if [[ -f "$HOME/.sailor/credentials.json" ]] && grep -q "testkey123456" "$HOME/.sailor/credentials.json"; then
  rm "$HOME/.sailor/credentials.json"; ok "removed the old mock key from ~/.sailor/credentials.json"
fi
ok "mock-server variables cleared"

step "5/6 Keys (typed input is hidden)"
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then read -rsp "Anthropic API key (sk-ant-…): " ANTHROPIC_API_KEY; echo; fi
[[ "$ANTHROPIC_API_KEY" == sk-ant-* ]] || die "That doesn't look like an Anthropic key (sk-ant-…)."
if [[ -z "${FIBER_API_KEY:-}" ]]; then read -rsp "Fiber SANDBOX key (sk_test_…): " FIBER_API_KEY; echo; fi
[[ "$FIBER_API_KEY" == sk_test_* ]] || die "FIBER_API_KEY must be a sandbox key (sk_test_…) for this demo."
export ANTHROPIC_API_KEY FIBER_API_KEY
ok "Anthropic key ${ANTHROPIC_API_KEY:0:7}****${ANTHROPIC_API_KEY: -4}"
ok "Fiber sandbox key ${FIBER_API_KEY:0:8}****${FIBER_API_KEY: -4}"

step "6/6 Sandbox endpoint check"
if [[ "${SKIP_PROBE:-0}" == 1 ]]; then warn "skipped (SKIP_PROBE=1)"; else ./demo/probe-sandbox.sh; fi

printf "\n${B}Launching Sailor (sandbox, fresh workspace in /tmp/sailor-demo)…${N}\n"
printf "Footer should read: ${G}Fiber SANDBOX · no credits charged${N}\n"
sleep 2
LIVE=1 exec ./demo/run-demo.sh
