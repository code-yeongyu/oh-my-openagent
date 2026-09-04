# Issue #7677: Senpi QA isolation evidence

> SUPERSEDED: this original 40-test receipt is historical only. Use `../20260903-issue-7677-c42f893c9-reviewer-remediation/`, generated fresh for source head `c42f893c953df103a38c42820568ccde34fcc215`.

## What was tested

- Deterministic RED: the two new isolation suites failed because `./isolation-state.mjs` did not exist (0 pass, 2 fail).
- Focused GREEN: blocker, bounded-isolation/race, and task-13 suites passed (40 pass, 0 fail).
- Real harness: the repository `drive.mjs` ran the installed Senpi binary with an isolated child home and agent directory.
- Package gate: one serialized `bun run test:senpi` completed successfully (2,558 pass / 7 platform skips / 0 fail, followed by 10 pass / 0 fail for the evidence resolver).
- Static gates: package typecheck, exact scoped Biome check, no-excuse audit, LSP diagnostics, extension freshness, whitespace, JSON, secret, and repository-diff checks.

## What was observed

The real driver returned `PASS`. Both protected-state checks were complete and error-free. `realSenpiUntouched` and `realOmoUntouched` were true, and both canonical changed-path arrays were empty. The driver set both `HOME` and `USERPROFILE` to its sandbox.

Recursive home observation reached its explicit byte cap and reported `complete=false` and `truncated=true`, with no observation errors. This is supporting telemetry only: the isolation verdict is the protected-state comparison plus every observed nonvolatile path, not a claim that either whole home was exhaustively scanned.

## Why this is enough

The focused tests cover ENOENT-only absence, EACCES/EIO fail-closed behavior, file/entry/byte limits, descriptor reads, bigint identity and timestamp windows, same-size mutation, growth, shrink, replacement before and after open, primary-error precedence, canonical slash paths, Windows-shaped volatility, and persistent-write verdicts. The live run proves those helpers are integrated into the real Senpi QA surface without touching either real agent home.

## Why PR #7540 was not reopened

PR #7540 is closed and its branch carries stale downstream/evidence history. Issue #7677 is implemented as a fresh source-focused branch from current `origin/dev`; only still-relevant QA isolation behavior was adapted from the read-only reference at `f4a4fc8613f1f1153f27ca3b35de736abf05ca4d`.

## Omitted and sanitized

No credential content, protected-file digest, environment dump, auth header, token, or raw model transcript is stored here. The large package-gate stream was reduced to command and terminal summaries. Temporary sandbox paths are retained only as non-secret isolation evidence; the driver removed the sandbox on exit.
