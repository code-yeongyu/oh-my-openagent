# Windows facts failure-store timeout repair

## What was tested

- Inspected GitHub Actions run `33582797101`, attempt 1, Windows shard 1. The three exact `facts failure store persistence` timeouts are captured in `ci-windows-facts-excerpt.txt`.
- Compared the failed SHA with current `origin/dev` for the memory and Senpi facts paths; reviewed merged PR #7602 and its lock-candidate fixes. `source-and-repair-baseline.txt` records the exact SHAs.
- Added a deterministic filesystem-seam test for a Windows `EPERM` candidate-unlink failure. It performs two normal acquisitions and asserts the first fresh candidate gets only its original three bounded unlink attempts; then it ages leaked candidates and proves the ordinary stale sweep reclaims them.
- Ran the failing proof before the implementation, the focused lock suite, the exact facts failure-store persistence suite, and the full memory-core package suite.
- Ran the package gate `bun run test:senpi`, which stages the committed Senpi extension bundle and runs the adapter suite. Ran the real Senpi driver after staging: `node packages/omo-senpi/scripts/qa/drive.mjs --self-test` and `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs`.
- Ran full `bun run typecheck` and `bun run build` with repository-pinned Bun 1.4.0. Ran the committed Senpi extension and directive freshness checks with the same Bun on `PATH`.

## What was observed

- The original deterministic test was RED on unchanged production code: `Expected: 3`, `Received: 6`. The second lock acquisition re-swept a fresh sharing-blocked candidate before publishing its own lock, exactly the unbounded advisory work that can consume a 5-second facts persistence test budget.
- After the repair, the lock test passed (6 pass), all exact facts persistence cases passed (9 pass), and `bun test packages/memory-core/src` passed (652 pass). See `red-fresh-candidate-retry.log`, `green-candidate-sweep.log`, `green-facts-failure-store.log`, and `package-memory-core.log`.
- `bun run test:senpi` passed: 2,530 pass, 1 platform skip, 0 fail. The staged bundle checks passed in `generated-bundle-check.log` and `generated-directive-check.log`.
- After rebasing onto `origin/dev` `bd702cb8`, the focused facts/lock tests, `bun run test:senpi` (2,530 pass, 1 skip, 0 fail), generated-bundle freshness check, and isolated live Senpi driver all passed again. See `rebase-focused.log`, `rebase-test-senpi.log`, `rebase-generated-bundle-check.log`, and `rebase-senpi-drive-live.json`.
- The real Senpi driver returned `result: PASS`, `ultraworkInjected: true`, and `commentChecker: PASS`. Its protected-state checks report `realSenpiUntouched: true` and `realOmoUntouched: true`; the only observed host entry was a volatile `logs/session.log`, excluded by the driver from attributed state changes. The driver removed its sandbox; cleanup is verified below.
- Full typecheck and full build passed. The full root suite had only environment-sensitive pre-existing failures: with this workstation's normal HOME, five OpenCode skill-reader tests see the existing `/Users/sungsoopark/.agents/skills`; with a clean HOME, unrelated path-default tests fail because they intentionally compare the host default paths. The exact failures and counts are preserved in `local-gates-summary.txt`. No local full-suite success is claimed; the PR is labeled `ci:full-matrix` so CI is the authoritative Windows proof.

## Why this is enough

The repair removes only the unsafe immediate-retry mechanism. A candidate is never a lock after hard-link publication, so a Windows sharing denial cannot alter ownership or mutual exclusion. Fresh candidates now remain eligible for the existing age-based stale sweep rather than delaying the next facts operation. The deterministic RED/GREEN test proves that boundary, while the exact three previously timed-out persistence cases prove their data behavior remains intact. The memory package, staged Senpi gate, live isolated Senpi harness, generated-bundle check, typecheck, and build cover the affected core, shipped adapter surface, and package artifacts. CI will supply the required Windows platform proof.

## Cleanup and omissions

- The Senpi driver sandboxes reported in `senpi-drive-live.json` and `rebase-senpi-drive-live.json` no longer exist after the drivers completed. The temporary clean-HOME directory used for the full-suite isolation attempt was removed and verified absent.
- Worktree-owned LSP daemons started by test/build tooling are terminated and verified absent in `cleanup-receipt.txt`.
- No OpenCode or Codex real-harness QA was run: no OpenCode or Codex source was changed. The only adapter artifacts are the required generated Senpi bundles, and their real Senpi harness QA is recorded above.
- Full raw command logs remain in this ignored evidence directory to avoid adding multi-megabyte generated test output to the review diff. This README plus the committed focused logs are the reviewer-readable summary. No credentials, environment dumps, auth files, or raw host logs are included.
