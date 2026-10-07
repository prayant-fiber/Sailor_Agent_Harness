#!/usr/bin/env bash
# Checks which Fiber endpoints the demo uses work with a sandbox key (sk_test_…).
# Sends an empty body to each endpoint and looks only at the HTTP status:
#   501            → not sandboxed yet (skip that scene or use a live key)
#   400/422        → sandboxed (request was validated, the body was just empty)
#   200            → sandboxed and answered
#   401/403        → key problem
# No credits are charged with a sandbox key.
# Usage: FIBER_API_KEY=sk_test_... ./demo/probe-sandbox.sh
set -uo pipefail
KEY="${FIBER_API_KEY:?Set FIBER_API_KEY to your sk_test_ key}"
BASE="${FIBER_BASE_URL:-https://api.fiber.ai}"

probe() { # method path label
  local code
  if [[ "$1" == GET ]]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $KEY" "$BASE$2")
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' -X "$1" -H "x-api-key: $KEY" -H 'Content-Type: application/json' -d '{}' "$BASE$2")
  fi
  local verdict
  case "$code" in
    501) verdict="✗ not sandboxed" ;;
    401|403) verdict="✗ key rejected" ;;
    2??|400|422) verdict="✓ sandboxed" ;;
    *) verdict="? HTTP $code" ;;
  esac
  printf '%-34s %-40s %s\n' "$3" "$2" "$verdict"
}

echo "Probing $BASE with ${KEY:0:8}****${KEY: -4}"
probe GET  /v1/get-org-credits                 "Credit meter / balance"
probe POST /v1/nlp-search/parse                "ICP parse (scene 3)"
probe POST /v1/people-search/count             "Count (scene 3)"
probe POST /v1/people-search                   "People search (scene 3)"
probe POST /v1/company-search                  "Company search"
probe POST /v1/nlp-search/run                  "NL search"
probe POST /v1/kitchen-sink/person             "Profile enrich (cards)"
probe POST /v1/kitchen-sink/company            "Company enrich (cards)"
probe POST /v1/kitchen-sink/bulk/profile       "Repair, small files (scene 7)"
probe POST /v1/contact-details/single          "Reveal email/phone (scene 5)"
probe POST /v1/contact-details/batch/start     "Batch reveal (scene 5)"
probe POST /v1/validate-email/single           "Email validation (scene 5)"
probe POST /v1/mosaic/start                    "Mosaic repair, large files"
