# PR 6043 twenty-ninth review repair

## Finding

The final code-review lane found that `session.status` stored its retry dedupe
key before attempting to abort the active request. When that abort was
rejected, the key remained stored, so a later identical retry signal was
discarded and could not retry cancellation or dispatch the configured
fallback.

The failing-first direct regression observed one abort attempt and no fallback
after two identical status events. The composed-hook regression covers the SDK
shape where the first abort resolves with `{ error: ... }` and the second
abort succeeds.

## Repair

Source commit `07550aea1af6ccdae0f1de71ce4a7c98cfdab655` releases the
retry key on both abort-rejection return paths. The release is conditional on
the map still holding the same key, so a newer event cannot be erased by an
older asynchronous rejection.

## Exact-head verification

- Direct and composed regressions: 8 pass / 0 fail across 2 files.
- Full runtime-fallback suite: 304 pass / 0 fail across 48 files.
- Plugin lifecycle/model boundary suite: 66 pass / 0 fail across 5 files.
- OpenCode adapter `tsgo --noEmit`, scoped Biome 2.4.16, no-excuse audit,
  `git diff --check`, and pure-LOC checks pass.
- Mandatory isolated real OpenCode QA passes at the exact source commit: the
  older of two active roots recovers through fallback, deleting the newer root
  restores the older root, the successful fallback does not re-arm the
  watchdog, a later user abort remains external, one sandbox session is
  created, and the real OpenCode database is unchanged.

## Why this is enough

The repair changes only failed-abort ownership cleanup. The direct test proves
the rejected key is reusable, the composed test proves the public hook retries
the real SDK abort boundary, the full suites cover neighboring ownership and
lifecycle races, and the real harness preserves the user-visible watchdog
workflow and isolation guarantees.

## Omitted or bounded

No secrets, auth headers, raw environments, private credentials, local session
IDs, or database paths are included. Initial bounded readiness probes may log
connection-refused lines before the local services become ready; the accepted
run proceeds only after health and SSE readiness succeed and ends with no QA
processes left behind.
