#!/usr/bin/env bash
# End-to-end validation of the Rhino Compute RESThopper pipeline used by the
# app: /io inspection + /grasshopper solve of the sample template definition.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
source .env.local
set +a

ALGO=$(base64 -w0 public/definitions/09_Bookcase.gh)

echo "== /io =="
curl -s -m 60 -H "RhinoComputeKey: $RHINO_COMPUTE_KEY" -H "Content-Type: application/json" \
  -d "{\"algo\":\"$ALGO\"}" "$RHINO_COMPUTE_URL/io" \
  | python3 -c "import json,sys; io=json.load(sys.stdin); print('inputs:', ', '.join(i['Name']+'('+i.get('ParamType','?')+')' for i in io.get('Inputs',[]))); print('outputs:', ', '.join(o['Name'] for o in io.get('Outputs',[])))"

echo "== /grasshopper (defaults) =="
curl -s -m 120 -H "RhinoComputeKey: $RHINO_COMPUTE_KEY" -H "Content-Type: application/json" \
  -d "{\"algo\":\"$ALGO\",\"pointer\":null,\"modelunits\":\"millimeters\",\"dataversion\":2,\"absolutetolerance\":0.1,\"angletolerance\":1.0,\"values\":[]}" \
  "$RHINO_COMPUTE_URL/grasshopper" \
  | python3 -c "import json,sys; r=json.load(sys.stdin); print('errors:', r.get('errors')); print('warnings:', (r.get('warnings') or [])[:2]); print('outputs:', [(v['ParamName'], sum(len(b) for b in v['InnerTree'].values())) for v in r.get('values',[])])"
