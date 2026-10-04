#!/usr/bin/env bash
# End-to-end smoke: create a review via the API and tail SSE until a terminal event.
# The server closes the SSE stream itself after done/error/rejected/cancelled.
set -euo pipefail
API="${API:-http://localhost:8000/api/v1}"
TOPIC="${1:-metformin colorectal cancer risk}"

echo "→ health"; curl -fsS "$API/healthz"; echo
echo "→ create"
CREATE=$(curl -fsS -X POST "$API/reviews" -H 'content-type: application/json' \
  -d "{\"topic\":\"$TOPIC\",\"language\":\"th\"}")
echo "$CREATE"
ID=$(echo "$CREATE" | python -c 'import sys,json; print(json.load(sys.stdin)["review_id"])')

echo "→ events (until a terminal event, max 120s)"
curl -sN --max-time 600 "$API/reviews/$ID/events" | grep -E '^(id|event|data):'

echo "→ result"
curl -fsS "$API/reviews/$ID" | python -c 'import sys,json; r=json.load(sys.stdin); print(r["status"], r["result"]); sys.exit(0 if r["status"] == "done" else 1)'
