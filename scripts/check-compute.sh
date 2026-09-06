#!/usr/bin/env bash
# Health-check Rhino Compute using gh-forge/.env.local (key never printed).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
source .env.local
set +a

curl -s -o /dev/null -m 6 -w "healthcheck: %{http_code} (%{errormsg})\n" \
  -H "RhinoComputeKey: $RHINO_COMPUTE_KEY" "$RHINO_COMPUTE_URL/healthcheck"
