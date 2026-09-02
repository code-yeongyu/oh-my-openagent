# Windows memory supervisor released-child QA

## What changed

The real supervisor -> detached bootstrap -> model-child integration test now waits for the model child's emitted `child-started.json` lifecycle signal before it reads the durable bootstrap PID. It subscribes to the supervisor close event before the abrupt kill, uses asynchronous Windows `taskkill /T /F` completion, and requires the child TCP connection to close after tree termination. The test therefore identifies the exact stalled post-kill phase instead of falling through to the 60-second test watchdog.

Tested source SHA-256:
`15c89efb82d25531912d095ecec79d23fb60a85c42defeb26e8c65019e5f0f19` for `memory-run-supervisor.integration.test.ts`.

## RED

**What was tested:** the exact native Windows Senpi compatibility job on the unchanged dev merge.

**Observed:** [job 100190136669](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/33612304861/job/100190136669) failed the named released-child test after 60059.49 ms. Its lifecycle waiter reported `waited 60000ms for child identity`; 2516 tests passed and 14 skipped. The failure occurs in the real supervisor/bootstrap/model-child fixture before a confirmed post-kill phase, so it did not prove a production process-group policy defect.

**Why sufficient:** the failing test and the CI evidence exercise the exact Windows-only production seam that motivated this repair.

## GREEN

- **Focused supervisor test:** `bun test packages/omo-senpi/src/components/memory/worker/memory-run-supervisor.integration.test.ts --test-name-pattern 'released child'` passed: 1 pass, 0 fail. It drove the real three-process tree and required supervisor close, real tree termination, and child socket close.
- **Adjacent supervisor containment:** integration plus IC-8 suites passed: 17 pass, 0 fail. The IC-8 cases retain injected Windows deadline and `taskkill /T /F` coverage.
- **Adjacent worker suite:** `bun test packages/omo-senpi/src/components/memory/worker` passed: 238 pass, 0 fail.
- **Typechecks:** `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`, `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json`, and root `bun run typecheck` all exited 0.
- **Senpi package gate:** `bun run test:senpi` passed: 2530 pass, 1 platform skip, 0 fail; the evidence resolver contract added 10 pass, 0 fail. See `test-senpi-summary.txt`.
- **Root build:** `bun run build` exited 0. This test-only source change does not alter extension inputs; local Bun 1.3.14 produces non-byte-identical bundles, so the committed CI Bun 1.4 artifacts remain unchanged and the Ubuntu bundle check is the canonical artifact validation.
- **Live Senpi QA:** the real `senpi` binary loaded the plugin in an isolated sandbox. `drive.mjs --self-test` passed and `drive.mjs` reported PASS, hidden ultrawork injection, comment-checker PASS, and no real Senpi or omo state changes. See `live-driver.json`.

## Root test gate note

A local full `bun test` was run before the root build and failed only on host/toolchain preconditions unrelated to this test change: the installed Bun 1.3.14 lacks the Bun 1.4 directory-asset support required by the Darwin embedded-payload probe, and the non-isolated host HOME contributed a local skill path to five OpenCode config-reader tests. After `bun run build`, the Codex installer version test passed; the config-reader suite passed under an empty HOME. Final CI uses Bun 1.4 and the actual Windows root/Senpi matrix is the release gate for this PR.

## Isolation and cleanup

The live driver created its own temporary agent directory and project directory. Its report recorded `realSenpiUntouched: true`, `realSenpiCredentialDigestUntouched: true`, `realOmoUntouched: true`, empty changed-path lists, and no protected state changes. The task-owned sandbox directories were removed after the driver completed; no child PIDs remained according to the driver cleanup receipt.

## Omitted

Raw full-suite logs, temporary absolute paths, and environment-bearing process output are intentionally not committed. The committed summaries retain machine-consumed pass/fail counts and the live-driver isolation fields without host-specific paths or credentials.

## Residual risk

Native Windows process behavior cannot be executed on this macOS workstation. The final `ci:full-matrix` Windows root and Senpi compatibility jobs are required to close that gap; the test's new phase-specific lifecycle failures will identify the responsible operation if it regresses.
