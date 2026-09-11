# Issue #7677: Senpi QA isolation hardening

Base: `origin/dev` at `cca216272585a55aeb94a864d3b0bed704dd40f9`.
Branch: `fix/7677-senpi-isolation`.
Reference: read-only `omo-pr7500-postmerge-cleanup` at `f4a4fc8613f1f1153f27ca3b35de736abf05ca4d`; port source behavior only, never history or stale evidence.

## Decisions

- Keep the implementation inside `packages/omo-senpi/scripts/qa/`; repository evidence and this plan are the only non-QA additions.
- Split bounded stable file reads into `isolation-file-readers.mjs`, isolation snapshots/verdicts into `isolation-state.mjs`, and keep `drive.mjs` as orchestration.
- Preserve current-dev transient tree-entry handling and normalized volatile settings stamps while making access/I/O failures explicit and fail-closed.
- Define the verdict as the sorted set union of direct protected changes, observed protected changes, and observed nonvolatile changes. Exclude only canonical `sessions/`, `cache/`, `logs/`, and `*.log` observations.
- Bound recursive observation by files, entries, and bytes. Report completeness, truncation, errors, and bytes without claiming complete whole-home coverage.
- Use descriptor/chunk reads and bigint identity/size/timestamp windows to detect replacement and mutation races. Preserve primary errors over diagnostic/close errors; report close errors only when no primary exists.
- Set both `HOME` and `USERPROFILE` for child QA. Emit no credential contents or protected hashes in evidence.
- Preserve all `script/**`, package manifests, lock/pins/patches, generated bundles, compile runtime, OAuth behavior, hooks fixtures, and unrelated tests byte-for-byte relative to this base.

## Granular task state

- [x] Create isolated worktree/branch, fetch and fast-forward to latest `origin/dev`.
- [x] Read applicable root/package/QA `AGENTS.md`, Senpi QA skill, current QA source/tests, and read-only reference source.
- [x] Restore the three checkout-induced CRLF artifact contents without staging them (raw blob hashes match HEAD; local index flags hide Git's inconsistent LF clean-filter report).
- [x] RED: add focused isolation contract tests for canonical verdicts, error semantics, limits, races, error precedence, path canonicalization, and child HOME/USERPROFILE.
- [x] Run focused tests and record the deterministic 0-pass/2-fail missing-module result.
- [x] GREEN: add bounded stable file readers and isolation state module; integrate them into `drive.mjs`.
- [x] GREEN: update current `task-13.test.ts` contracts while preserving current-dev transient-entry and settings-stamp behavior.
- [x] Run blocker/isolation/task-13 focused tests and driver self-test (40 pass, 0 fail; self-test OK).
- [x] Resolve a new evidence directory with the repository resolver and run the real isolated Senpi driver (PASS).
- [x] Run one serialized `bun run test:senpi`, package typecheck, exact scoped Biome check, LSP/no-excuse, and extension freshness.
- [x] Complete JSON/secret/diff checks and prove zero diff for `script/**`, manifests/pins/patches/compile/OAuth/generated/unrelated surfaces.
- [x] Record sanitized evidence explaining issue #7677 and why closed PR #7540 was replaced rather than reopened.
- [x] Complete final measurement/review and initial attributed delivery.

## Oracle remediation at `eef42638f`

- [x] Re-read exact-head reader/traversal implementations and existing error-precedence tests.
- [x] RED: prove a thrown observed-file read error survives a successful shrink diagnostic.
- [x] RED: prove a directory traversal error survives close failure and close-only failure still surfaces.
- [x] RED: prove observation errors/truncation withhold certification, symlinks are bounded without dereference, and path style is explicit.
- [x] GREEN: preserve the primary file-read error without changing zero-byte SHORT_READ behavior.
- [x] GREEN: append a directory close error only when traversal has no primary error.
- [x] GREEN: require complete nonvolatile-domain observations, account for symlinks/unsupported entries, and distinguish POSIX from Windows paths.
- [x] Run focused suites, self-test, typecheck, Biome, LSP/no-excuse, real driver, extension freshness, and final full Senpi gate.
- [x] Commit the source remediation separately with OMO attribution at `ba455bc1c9a60acc354915f909d89fd2cb338dc4`.
- [x] Update sanitized final-source-head evidence and repository-scope proofs; only the evidence-only attributed commit remains.

## Final reviewer remediation at `9e8ec6eb9`

- [x] RED: reproduce volatile maxEntries consumption and missing/arbitrary observation-domain certification.
- [x] RED: prove missing/empty directory identity, recursive directory-to-symlink replacement, and protected-state symlink dereference defects.
- [x] GREEN: filter volatility before all budgets and require the exact `nonvolatile-home` domain before certification.
- [x] GREEN: snapshot persistent directory markers, validate recursive directory identity/type, and fail protected symlinks closed without opening targets.
- [x] Commit source and regressions separately with OMO attribution at `c42f893c953df103a38c42820568ccde34fcc215`.
- [x] Produce a new head-specific 53-test receipt set and clearly supersede the old 40-test and 48-test receipts.
- [x] Run fresh self-test, real driver, package typecheck, exact Biome, LSP/no-excuse, one full Senpi gate, and integrity checks.

## Acceptance certification remediation at `b9500ddfc`

- [x] RED: retain the broad real-home scan's fail-closed truncation and prove a separate complete scoped-root verdict can certify independently.
- [x] RED: prove post-open directory replacement fails closed after traversal and all canonical path/error ordering is locale-independent.
- [x] GREEN: add a controlled live certification lane over the synthetic HOME and XDG roots, seeded with decoy default Senpi/OMO persistent state under the existing global bounds.
- [x] GREEN: capture the real QA child's selected HOME/USERPROFILE/XDG/SENPI agent environment and require exact sandbox routing plus operational PASS for certification.
- [x] GREEN: bind traversal to no-follow directory descriptors, fail root-open/ABA races closed, revalidate identity/type after traversal, and use canonical code-point ordering.
- [x] Run focused suites, driver self-test, package typecheck, exact Biome, LSP/no-excuse, one authoritative post-merge `bun run test:senpi`, and a fresh live driver from the exact source head.
- [x] Fetch and merge advanced `origin/dev`; retain the upstream drive export contract and prove restricted/unrelated surfaces unchanged relative to the updated base.
- [x] Commit source/regressions with OMO attribution, then refresh sanitized canonical evidence for a separate attributed evidence commit.
