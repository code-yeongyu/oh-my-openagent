# Plan: Windows facts failure-store timeout repair

## Scope
Repair the Windows lock-candidate cleanup path that can consume the 5-second timeout of multi-operation `FactsFailureStore` persistence tests. Keep the repair limited to `packages/memory-core` plus required generated Senpi artifacts and evidence.

## Findings before editing
- CI run 33582797101 attempt 1, Windows shard 1, timed out exactly three tests in `packages/memory-core/src/facts/failures-store.test.ts`: batch success cleanup (5390.98 ms), selective retry cleanup (6260.17 ms), and corrupt-ledger read (5212.22 ms).
- All three acquire the same facts lock more than once. `FactsFailureStore.locked()` delegates every operation to `withLock()` (`packages/memory-core/src/facts/failures-store.ts:164-169`).
- The current lock implementation tracks a candidate that Windows refuses to unlink, rearms the directory sweep, and immediately retries all tracked candidates on the next acquisition (`packages/memory-core/src/locks/acquire.ts`, `candidate-sweep.ts`). Candidate files are not ownership records after their hard link publish attempt, so their cleanup must not delay a later acquisition.
- The source at `origin/dev` is byte-identical to failed SHA `60c8577fca325cc5680730ca9aaf0e80ce202785` for the memory/facts paths; attempt 2 at that SHA passed the three cases. This confirms an intermittent Windows cleanup path rather than a semantic facts-store failure.
- Prior merged PR #7602 added sharing-error recovery, but its immediate retry/rearm behavior leaves the test-timeout path possible.

## Atomic todo
1. Read the complete existing candidate-sweep tests and the final PR #7602 commits; formulate the minimal invariant: an advisory Windows sharing error cannot make the next lock acquisition wait on stale candidate cleanup.
2. Add one deterministic red test in `packages/memory-core/src/locks/candidate-sweep.test.ts` using the existing filesystem seam. It must prove a still-sharing candidate does not get synchronously re-swept during the next acquisition and that a later healthy sweep reclaims it.
3. Implement the smallest lock cleanup change in `packages/memory-core/src/locks/` that preserves exclusive lock publication and eventual candidate cleanup while removing the repeated synchronous cleanup path.
4. Run the red/green focused lock and facts-store tests with CI-pinned Bun 1.4.0; run diagnostics/typecheck for memory-core and the package test suite.
5. Rebuild required generated Senpi plugin artifacts, run `bun run test:senpi`, and run the real isolated Senpi driver prescribed by `.agents/skills/senpi-qa`.
6. Write reviewer-readable evidence under `.omo/evidence/omo-senpi-adapter/20260902-windows-facts-failure-store/`, including CI log facts, local red/green output, real-harness isolation result, generated-artifact freshness, and cleanup receipt.
7. Review the diff, commit the atomic repair and evidence, push a PR to `dev`, wait for CI and Cubic, and address only verified findings. Do not merge.

## Verification contract
- Focused lock test: simulated persistent `EPERM` sharing failure cannot block a subsequent acquisition; after the seam becomes healthy, the leaked candidate is reclaimed.
- Focused facts store tests: all nine persistence cases, including the three original failures, pass once in one Bun process.
- Package gate: `bun run --cwd packages/memory-core typecheck` and `bun test packages/memory-core/src` pass using Bun 1.4.0.
- Senpi adapter gate and live harness QA complete with isolated agent-directory evidence; no host Senpi directory mutation.
- PR gates: GitHub CI green and latest Cubic review reports no issues, or a documented Cubic quota skip. Stop when the unmerged PR is green and review-clean.
