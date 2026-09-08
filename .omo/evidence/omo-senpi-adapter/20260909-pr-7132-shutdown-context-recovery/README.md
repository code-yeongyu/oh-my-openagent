# PR #7132 shutdown-context recovery QA

## What was tested

- Resolved this directory with `.agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs` using slug `20260909-pr-7132-shutdown-context-recovery`.
- Ran the real Senpi shutdown driver with the built local CLI and an HTTP mock completions provider:
  `bun packages/omo-senpi/scripts/qa/shutdown-context-e2e.mjs`.
- The driver seeds isolated memory, starts a print-mode parent, enables shutdown reflection, waits on the pre-subscribed filesystem signal with bounded rechecks, then starts a replacement session to consume the durable completion.
- Ran focused regression tests:
  `bun test packages/omo-senpi/src/components/memory/wiring.test.ts packages/omo-senpi/src/components/memory/shutdown-drain.test.ts packages/omo-senpi/src/components/memory/dream-trigger-shutdown.test.ts`.
- Ran the relevant QA contract checks for the shared drivers, including the `drive.mjs` and `probe-continuation.mjs` self-tests and caller-agent-dir isolation test.
- Verified `build-extension.mjs --check` and `stage-agent-toolkit.mjs --check`.

## What was observed

The captured driver result is in [`result.json`](./result.json). It reports `PASS` with all eight checks true:

- the seed and replacement probes exited zero;
- the parent observed the exact `OK` answer;
- no stale extension-context error appeared;
- a shutdown completion was recorded with `origin: shutdown` and successful `outcome: no_changes`;
- durable delivery reached `status: consumed` in the replacement session; and
- the real `~/.senpi/agent` remained untouched.

The driver reports the redacted isolated paths `sandboxAgentDir: <sandbox>/agent` and `sandboxCwd: <sandbox>/project`. Its child environment sets `SENPI_CODING_AGENT_DIR`, `OMO_CODING_AGENT_DIR`, `PI_CODING_AGENT_DIR`, `HOME`, `USERPROFILE`, and the XDG directories to sandbox-owned paths; `environment-receipt.ts` validates the values inside the child. The completion path and all machine-local sandbox paths are redacted in the artifact.

The focused memory suites passed with 36 tests and 87 assertions. The three relevant QA contract checks passed with 42 assertions. The bundle and staged runtime checks passed, including the agent-toolkit digest `da627576534832004728015abe6289c8bd7b313dbe31e6a4416fdfe2c4a3e561`.

The full local `bun run test:senpi` gate was attempted on this Windows host: 2,674 passed, 41 skipped, and 11 failed. The failures are existing platform/environment cases: symlink tests without Windows symlink privilege, the POSIX `mkdir -p` helper in the shared QA self-tests when Git's POSIX bin directory is absent from `PATH`, one Windows RPC process proof, and unrelated status/workspace assertions. With the existing Git POSIX helper directory on `PATH`, the three relevant QA contract checks pass; the full-gate residuals were not attributed to the shutdown-context change.

## Why it is enough

The live run exercises the reported replacement-session boundary through the real Senpi process and verifies the complete durable lifecycle rather than only absence of the old error. The focused tests cover callback-context refresh, replacement ordering, shutdown drain ordering, cancellation, and completion delivery. Build checks confirm the shipped extension remains current.

## What was omitted

Raw child stdout/stderr, environment dumps, auth material, and local absolute paths were omitted or redacted. No secrets are copied into this evidence directory. The full-gate failure logs are summarized above because they contain transient machine paths and unrelated platform diagnostics.
