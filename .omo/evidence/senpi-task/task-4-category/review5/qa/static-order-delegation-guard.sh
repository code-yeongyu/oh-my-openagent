#!/usr/bin/env bash
set -euo pipefail

echo "Surface: static order-delegation guard"
echo "Invocation: bash .omo/evidence/senpi-task/task-4-category/review5/qa/static-order-delegation-guard.sh"
echo
echo "delegate-core resolver references:"
rg -n "resolveModelForDelegateTask|@oh-my-opencode/delegate-core|CATEGORY_FALLBACK_CHAINS" \
  packages/senpi-task/src/category/resolver.ts \
  packages/senpi-task/src/category/fallback-chains.ts \
  packages/senpi-task/src/category/types.ts
echo
echo "forbidden local order constructs:"
if rg -n "modelOrder|providerOrder|MODEL_ORDER|PROVIDER_ORDER|seven.?step|7.?step|rankedModels|rankProviders|connectedProviders.*sort|providers.*sort|toSorted\\(" \
  packages/senpi-task/src/category/resolver.ts \
  packages/senpi-task/src/category/fallback-chains.ts
then
  echo
  echo "FAIL: local order construct matched."
  exit 1
fi

echo "PASS: no local model/provider order implementation matched; resolver delegates selection and fallback chain is data only."
