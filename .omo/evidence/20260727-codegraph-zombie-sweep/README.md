# CodeGraph zombie sweep QA evidence

Date: 2026-07-27
Worktree: `/Users/yeongyu/local-workspaces/omo-wt/fix/codegraph-zombie-sweep`
Branch: `fix/codegraph-zombie-sweep`

## What was tested

1. Matcher coverage against the exact observed orphan command lines for:
   - `~/.claude/omo/node_modules/@colbymchenry/codegraph-darwin-arm64/node --liftoff-only .../codegraph.js status --json`
   - `~/.omo/codegraph/node --liftoff-only .../codegraph.js status --json`
   - npm shim ownership chains, Windows platform/provisioned equivalents, and daemon classification.
2. Timeout tree termination with a real child that spawns a SIGTERM-resistant grandchild in the detached process group.
3. The real process table on this machine, including six PPID-1 CodeGraph status workers in `U` state.
4. Worker-vs-daemon sweep cadence, including an active daemon lock regression.
5. Utils, CodeGraph component, Codex, and Senpi automated gates.
6. A real isolated Codex app-server turn using the local build, an isolated `CODEX_HOME`, and the local mock model.

## What was observed

- The triggering incident reached four concurrent PPID-1 workers at roughly 1 GiB RSS each and 25-60% CPU, in `R`/`U` states, surviving for minutes beyond the 60-second worker timeout. Manual `kill -9` was the only effective remedy, and load average peaked at 298 on an 18-core machine.
- `matcher-reproduction.json`: both exact real-world orphan fixtures were selected as `upstream-codegraph`.
- `tree-kill-reproduction.txt`: the timeout path sent process-group SIGTERM, escalated to process-group and per-process SIGKILL, reported `survivorPids: []`, and the post-run `ps` output was `<none>`.
- `final-real-orphan-sweep.txt`: six real PPID-1 workers were present before the sweep, all in `U` state, totaling 6,648,592 KB RSS (about 6.34 GiB) and 220.8% CPU. The new selector chose all six, the sweep sent termination/escalation, and the post-sweep process query returned no matching workers.
- `process-sweep-tests.txt`: 57 passed, 0 failed.
- `utils-tests.txt`: 465 passed, 0 failed.
- `codegraph-component-tests.txt`: 65 passed, 0 failed before the dev merge; the final post-merge component run passed 67, 0 failed.
- `test-codex.txt`: five green test groups totaling 1,483 passed (95 + 420 + 65 + 389 + 514), 0 failed.
- `test-senpi.txt`: 402 passed, 0 failed.
- `typecheck.txt`, `tsc-utils.txt`, and `tsc-codegraph-component.txt`: root `tsgo` gate plus utils/component `tsc --noEmit` completed successfully.
- `build.txt` and `dist-check.txt`: root/component bundles rebuilt; after resolving the dev merge by regeneration, the committed Senpi extension check again reported current output.
- `codex-qa-common.txt`, `codex-install-verify.txt`, and `codex-app-server.json`: isolated Codex dependencies and mock model passed, local plugin install landed, the CodeGraph SessionStart hook emitted first-party `hook/started` and `hook/completed`, the turn completed, and the real `~/.codex/config.toml` SHA-1 remained `d1cb6b3a9a0de1d6c50e7f5391fba3b78b4778c4`.

## Why this is enough

- Pure matcher tests cover the missed path families and owner-chain behavior without broadening matching outside trusted OMO roots.
- Daemon-shaped commands still route through the existing project-lock staleness decision and live-lock tests prove they are spared.
- The real timeout reproduction proves the detached process group and direct descendants are gone before a timed-out result resolves.
- The real machine sweep proves the exact damaging `U`-state orphan shape is selected and reaped outside a fixture.
- The isolated Codex app-server evidence proves the rebuilt local plugin loads and its SessionStart CodeGraph hook completes through the real harness without touching the user's Codex config.

## Residual risk

- POSIX cannot make a process leave uninterruptible kernel I/O immediately. The timeout result now records every signal attempt and reports any PID still observable after the bounded wait; the real `U`-state reproduction on this machine accepted SIGKILL and reached zero matching survivors.
- Windows uses `taskkill /T` followed by `/F`; Windows command-shape coverage is unit-tested, while the real process-group reproduction was run on macOS.

## What was omitted or limited

- No credentials, tokens, auth headers, or environment dumps were recorded.
- The optional `omo-programming` no-excuse audit script was attempted but failed inside the audit tool before scanning files because its TypeScript import exposed `ts.ScriptTarget` as undefined under the installed TypeScript/Bun combination. Repository `tsgo`, utils `tsc`, component `tsc`, tests, and builds were used as the compiler/style gates instead.
- LSP diagnostics requests timed out against the already-running local LSP daemon; the full root typecheck and package-specific compiler gates passed.
