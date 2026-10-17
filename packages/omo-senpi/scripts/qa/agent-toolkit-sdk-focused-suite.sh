#!/usr/bin/env bash
# Focused gate for the agent-toolkit SDK lane: the component contract that owns the SDK, then the
# Senpi adapter surfaces that now call it in-process. Exits with the test runner's own status so a
# red suite cannot be reported as a pass.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "${repo_root}"

echo "== toolkit component: SDK contract and session scope =="
(
  cd packages/omo-codex/plugin/components/ulw-loop
  bunx vitest run test/sdk-contract.test.ts test/sdk-session-context.test.ts test/state-lock.test.ts
)

echo "== omo-senpi: ulw-loop component (tool registration + in-process status) =="
bun test packages/omo-senpi/src/components/ulw-loop

echo "== typecheck =="
bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json
