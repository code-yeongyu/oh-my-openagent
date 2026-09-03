# Windows DAG runtime overflow synchronization

## Goal

Repair the Windows-only timeout in `packages/omo-senpi/src/components/task/dag-runtime-config.test.ts` without changing production deadlines, weakening the durable-overflow contract, adding sleeps/polling/retries/platform skips, or inflating a timeout.

## Failing-first evidence

- GitHub Actions run: `33605988668`
- Failing job: `100170026847` (`senpi-compatibility (windows-latest)`)
- Exact failed-log facts: Bun emitted `^ this test timed out after 5000ms.`; the runner's final case line reported `[6459.54ms]`, including delayed termination and cleanup after that timeout.
- The same run passed the Ubuntu and macOS Senpi compatibility jobs. The failure occurred after the surrounding DAG RPC handler tests passed and before later DAG tests ran.
- Current `origin/dev` is `d20c167da`; the task-owned branch is `fix/windows-dag-runtime-overflow-sync`.

## Diagnosis hypothesis and decision rule

The test creates only an implicit scheduler startup burst and awaits an externally observed overflow before allowing the controlled child to settle. The overflow is a valid durable scheduler behavior, but the fixture does not explicitly make the scheduler's backpressure window a test-controlled state. This makes the assertion depend on host microtask and fixture scheduling. The production runtime delivers the configured ring through `createDagRuntime` into every scheduler and forwards journal events through the RPC bridge; no production defect will be claimed unless a controlled burst fails to emit or persist the overflow.

## Atomic implementation and verification checklist

- [x] Create a fresh worktree from `origin/dev`, pin the local test binary to CI Bun `1.4.0`, and capture the GitHub failure reference.
- [x] Read the adapter/runtime and DAG scheduler/journal paths through the RPC forwarding seam.
- [x] Replace the implicit one-node startup timing with a controlled, two-node admission burst in `dag-runtime-config.test.ts`; subscribe before the trigger and retain assertions for both shipped RPC delivery and the durable WAL record.
- [x] Keep controlled child starts blocked until the test has observed the overflow, then release and settle each child through explicit promises; the completion waiter subscribes before the terminal trigger.
- [x] Run the focused test with CI-pinned Bun and the nearby DAG runtime/journal tests; typecheck the adapter and task engine.
- [x] Run `bun run test:senpi` once with CI-pinned Bun and record output.
- [x] Drive the real Senpi adapter in strict isolation with the canonical `senpi-qa` evidence resolver; record command, observed JSON, isolated agent path, real-home proof, cleanup receipt, and omission policy under `.omo/evidence/omo-senpi-adapter/20260902-windows-dag-runtime-overflow-sync/`. The optional live task driver exposed unrelated baseline/environment findings; its raw session-bearing transcript is omitted from the commit and the passing isolated adapter driver is the live QA claim.
- [x] Review and commit only the minimal test repair and evidence.
- [x] Push the atomic branch, open PR #7647 to `dev`, and apply `ci:full-matrix`.
- [x] Wait for the first full Windows Senpi compatibility job and all other CI checks; run `33608916045` passed, including the repaired Windows Senpi test.
- [>] Address the two valid evidence-review findings, push the existing branch, then wait for a fresh full matrix and Cubic review. Leave the PR unmerged as explicitly requested.

## Expected changed files

- `packages/omo-senpi/src/components/task/dag-runtime-config.test.ts`: deterministic fixture synchronization only.
- `.omo/evidence/omo-senpi-adapter/20260902-windows-dag-runtime-overflow-sync/*`: canonical QA artifacts and reviewer-readable receipt.

No production source file is planned. If a controlled fixture proves missing RPC delivery or missing durable WAL overflow, stop this plan, change the affected production seam, add a regression test, and repeat all verification.
