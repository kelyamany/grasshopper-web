#!/usr/bin/env bash
# Fetch the Rhino Compute API key from the Windows user environment (via
# work-server's ensure-rhino-compute.ps1) and write gh-forge/.env.local.
# The key is never printed to stdout.
set -euo pipefail

PS=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
SCRIPT=$(wslpath -w /home/khaled/repos/work-server/rhino_compute/ensure-rhino-compute.ps1)

KEY=$("$PS" -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT" -PrintApiKey 2>/dev/null | tr -d '\r\n')

if [ -z "$KEY" ]; then
  echo "FAILED to retrieve key from Windows user environment" >&2
  exit 1
fi

printf 'RHINO_COMPUTE_URL=http://localhost:6500\nRHINO_COMPUTE_KEY=%s\n' "$KEY" > .env.local
echo "key written to .env.local, length: ${#KEY}"
