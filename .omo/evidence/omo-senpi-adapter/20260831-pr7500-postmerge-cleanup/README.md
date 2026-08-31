# PR #7500 post-merge cleanup: isolation review evidence

Validated source head: `074bd7ebe8030a3e92ff010665fdc1ed71835332`, based on reviewed cleanup head
`30443d97c09bbb4eec3ca57035b7c88ad8690e14`. The final evidence-only commit does not change runtime
source.

## What was tested

- Deterministic RED for both review blockers: [`isolation-blockers-red.log`](isolation-blockers-red.log).
- Focused isolation/driver, OAuth, and package-pin suites: [`focused-tests.log`](focused-tests.log).
- Driver self-test: [`driver-self-test.log`](driver-self-test.log).
- Real `node_modules/.bin/senpi` drive with an intentionally ignored caller agent directory:
  [`driver-live.json`](driver-live.json), checked by
  [`driver-live-validation.json`](driver-live-validation.json).
- Typechecks, LSP, Biome, no-excuse, and generated extension freshness:
  [`typecheck-build-receipt.txt`](typecheck-build-receipt.txt).
- Serialized Senpi gate attempt: [`senpi-gate.log`](senpi-gate.log).
- Machine summary: [`isolation-review-receipt.json`](isolation-review-receipt.json).
- Cleanup: [`cleanup-receipt.txt`](cleanup-receipt.txt).

## What was observed

- RED was 3 pass / 5 fail: protected completeness did not exist; descriptor reads were bypassed by
  `readFileSync`; short read, growth, and replacement all falsely completed.
- GREEN is 19 pass for isolation/driver contracts. Identical protected `EACCES` failures now emit
  structured `{ path, code }` errors and force `real*Untouched` false. No protected content or hash is
  emitted.
- Observation hashing uses bounded descriptor chunks. Tests prove actual reads never exceed the
  remaining byte budget and deterministically classify short read, file growth, and path replacement
  without sleeps.
- The real live driver passed on the exact source head. Senpi and OMO protected snapshots were
  complete, error-free, unchanged, and therefore untouched. Recursive supporting observations were
  explicitly truncated with no errors. Across before and after snapshots, Senpi read 101,608,656
  bytes and OMO read 127,873,330 bytes; each individual snapshot is hard-bounded to 64 MiB.
- OAuth/compile-entry: 26 pass. Package/pin: 20 pass. Resolver: 10 pass. Extension freshness and all
  relevant typechecks passed.
- The required serialized `bun run test:senpi` was attempted once but did not reach tests: npm
  staging failed with `ENOSPC` while the root filesystem was full. This is recorded as blocked, not
  green and not a test failure. It was not retried. Task-owned fixtures were removed; unrelated user
  caches were not deleted.

## Why this is sufficient

The focused tests directly force both prior false-success paths, while the real driver proves the
new fields and fail-closed verdict through the production QA surface. Structured errors contain only
phase, relative path, and error code. Bounded observation reports paths/status only and never emits
file content or file hashes.

## Unchanged release evidence and external gate

This change touches only QA isolation code/tests, not packed or compiled production inputs. The prior
packed-install and compiled-OAuth artifacts remain applicable and are not relabeled as reruns on this
head. Packed OMO still pins Senpi `2026.8.30-3`; published Senpi `2026.8.31` contains the upstream
hooks fix, but npm hooks remain externally gated until OMO pins it and a clean packed-install hooks
test passes. `ELOCKED` is not success.

## Omitted or redacted

- No auth content, token, credential hash, private key, environment dump, or raw TUI output is
  retained.
- No file hash from protected or recursive snapshots is emitted in evidence.
