# Issue #8502 QA evidence

## What changed

`buildChildArgs` and `buildModelCatalogArgs` now consume one effective-extension selector. DAG-owned specs remove the leading OMO launcher for both paths; non-DAG specs preserve their full extension order.

## Evidence map

- `red-extension-parity.txt`: failing-first reproduction against the pre-fix implementation.
- `green-focused-and-typecheck.txt`: focused RPC/model-admission tests, DAG integration tests, and both TypeScript checks.
- `live-model-catalog-parity.ts`: reproducible narrow driver using the real Senpi binary and production catalog descriptor.
- `live-model-catalog-result.txt`: PASS receipt for provider-only DAG catalog visibility and isolation.
- `qa-driver-receipt.txt`: repository QA self-tests, full-driver host limitation, cleanup, and real-home isolation facts.
- `windows-posix-mkdir-preload.cjs`: evidence-only Windows compatibility shim for the QA driver's `mkdir -p` call.
- `package-gate-windows-baseline.txt`: transparent record of broader Windows-only baseline failures; no green claim is made for the full local package gate.

## Why this covers the risk

The failing-first fixture proves the original extension divergence. The green regression proves equality for both DAG and non-DAG specs. Existing DAG integration keeps the child-side launcher stripping invariant pinned. The real-Senpi probe proves the fixed admission descriptor loads the provider, exposes its model, and does not evaluate the stripped launcher.

## Isolation and cleanup

All live work used a temporary agent directory distinct from the real Senpi agent directory. Credential/config digests remained unchanged, the broad driver reported zero leaked PIDs, the targeted probe exited normally, and both sandboxes were removed by their drivers.

## Omitted material

Absolute local paths, randomized temporary names, complete model tables, repetitive passing-test output, raw environment dumps, credentials, auth headers, and private session content are intentionally absent.
