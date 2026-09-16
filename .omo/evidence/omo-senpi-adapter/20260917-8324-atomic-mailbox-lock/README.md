# Atomic team lock owner publication — QA evidence

## Scope

The shared lock name must never expose a partially written owner. A killed pre-publication writer can leave a private candidate; another process can still acquire. Existing live/dead-owner handling and contention remain unchanged.

## Automated checks

- `bun test --timeout 20000 packages/team-core`: 166 passed, one existing opt-in tmux smoke skipped. Includes a real Bun child exiting before publication and another owner acquiring, exclusive publication, and existing concurrent/stale owner tests.
- `bun run typecheck`: passed.
- `bun run build`: passed; affected Senpi member/task bundles regenerated.

## Real Senpi surface

Repository `senpi-qa` evidence resolver selected this directory. The repository driver self-test passed. Ran `packages/omo-senpi/scripts/qa/team-e2e.mjs` with the installed real Senpi binary and its built-in isolated mock-provider sandbox, using the locally built member/task bundles.

`results.json` records the exact verdict fields. The patch driver reported six failed lead-injection/resume assertions. Repeating the same driver with the target HEAD's original lock source and both original bundles produced all six failures, plus two additional crash-reservation failures. Both runs reported unchanged credentials, unchanged real agent directory, and zero leaked processes. The patch passed message delivery and exactly-once crash recovery checks. This is **not** a claim that the complete live QA suite passes.

## Original Windows evidence and limits

[Soak run](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/35110047990/job/104841095735) records the second process reaching `session_start` at 5373 ms, then no switch-session acknowledgement before the 20000 ms deadline. Member startup awaits its consumer lease. The previous create-then-write lock has an ownerless crash window, but the failed runner did not retain the lock contents; attribution to this occurrence remains unconfirmed.

A local residency run under concurrent build also hit 20 seconds, with a different trace: the second switch-session acknowledgement arrived at 19.18 seconds and the provider request at 20.09 seconds. No timeout budget was changed and that local run is not reported as passing. The independent installer manifest timeout remains outside this patch.

## Isolated OpenCode smoke

The repository `server-smoke.sh` passed against task-local OpenCode 1.17.7 with the local built plugin configured and isolated HOME/XDG directories: health reported version 1.17.7, OpenAPI listed 150 paths, and an unauthenticated session request returned 401. This checks server startup/API/authentication; it does not claim an OpenCode team interaction was exercised.

## Senpi compatibility suite

- `bun run test:senpi`: 3539 passed, 32 skipped, four failed (Darwin seatbelt child exit 71; facts reconciliation could not spawn `/bin/ps` with EPERM; original holder lifecycle liveness assertion; model-preflight grandchild pipe timeout). These failures are recorded without attributing them to this change or claiming a matching baseline.

## Root suite

`bun --config=bunfig.root.toml test --timeout 20000`: 15741 passed, 36 skipped, 45 failed across 1959 files. This repository configuration excludes the separately executed Senpi suite. The root suite is not green; no baseline equivalence is claimed for these failures. Failures span the generated Codex installer version, process inspection/lifecycle, NDJSON termination, LSP request contexts, native embedded runtime, OAuth permissions, config discovery, and OpenCode hooks. The existing 200-interleaving chaos bench passed.

<details><summary>Observed failing assertions</summary>

```text
(fail) #given the generated Codex installer #when release versions are synchronized #then its embedded package version matches the root release version [10.63ms]
(fail) listProcessCommands > includes a live child spawned by absolute executable path [71.00ms]
(fail) bounded sg NDJSON runner > #given records exceeding the aggregate payload cap #when the next record arrives #then output is truncated and the child is terminated [2011.74ms]
(fail) bounded sg NDJSON runner > #given a child that ignores SIGTERM #when aborted #then SIGKILL follows the grace period and no process remains [2007.62ms]
(fail) bounded sg NDJSON runner > #given a hung child #when the whole-call budget expires #then timeout termination is bounded [2006.97ms]
(fail) LspRequestContext > #given exact typed context #when parsed #then canonicalizes cwd and preserves typed paths [1.50ms]
(fail) LspRequestContext > #given unknown field #when parsed #then rejects before lookup [0.95ms]
(fail) LspRequestContext > #given project path outside cwd #when parsed #then rejects before config loading [0.88ms]
(fail) LspRequestContext > #given missing standard project config inside cwd #when parsed #then accepts and preserves the intended suffix [0.87ms]
(fail) LspRequestContext > #given symlink project config escaping cwd #when parsed #then rejects the escape [0.77ms]
(fail) LspRequestContext > #given standalone MCP env #when translated #then resolves exact defaults and relative paths [0.83ms]
(fail) LspRequestContext > #given an injected LSP cwd #when standalone context is created #then it wins over process cwd without reading global env [0.79ms]
(fail) LspRequestContext > #given explicit cwd and an injected LSP cwd #when standalone context is created #then explicit cwd wins [0.78ms]
(fail) missingDependencyResult > #given not configured lookup #when converted #then includes structured availability and typed config paths [1.17ms]
(fail) missingDependencyResult > #given not installed lookup #when converted #then includes install decision availability [0.85ms]
(fail) compiled omo entry launcher parity > recognizes a deleted Linux executable as the provisioned path [1.04ms]
(fail) compiled omo entry launcher parity > realpath-equivalent executable and expected paths skip re-exec [0.98ms]
(fail) pre-provisioning fast paths > fast-path version line matches the provisioned launcher's line for the same stamp [1.33ms]
(fail) embedded runtime provisioning > materializes the executable directly on Windows [0.91ms]
(fail) embedded runtime provisioning > does not overwrite an existing Windows provisioned executable [0.82ms]
(fail) embedded runtime provisioning > skips re-copying an identical provisioned executable on POSIX [0.88ms]
(fail) embedded runtime provisioning > still replaces a provisioned executable whose contents differ on POSIX [0.85ms]
(fail) embedded runtime provisioning > materializes the executable through a temporary non-executable path on POSIX [0.80ms]
(fail) embedded runtime provisioning > keeps an existing destination when the deleted Linux source cannot be read [0.88ms]
(fail) embedded runtime provisioning > still throws when the deleted Linux source and destination are both absent [0.81ms]
(fail) embedded runtime provisioning > compiled doctor resolves package artifacts from the provided execDir [1.24ms]
(fail) embedded runtime provisioning > version uses the manifest engine pin without a provisioned senpi package [1.47ms]
(fail) embedded runtime provisioning > materializes files whose embedded names carry the omo-runtime prefix [1.22ms]
(fail) embedded runtime provisioning > materializes non-utf8 embedded bytes without a text round-trip [1.26ms]
(fail) embedded runtime provisioning > materializes files with sha256 and mode, then skips on matching marker [1.09ms]
(fail) omob branded build labels > remapSenpiEnvironment brands dev builds with the label and command [0.92ms]
(fail) omob provenance degrades sanely > remapSenpiEnvironment falls back to the plain version and omo command for malformed build info [0.82ms]
(fail) launcher child signal forwarding > #given an engine child killed by a signal #when the launcher propagates the result > #then the launcher dies by that same signal [124.42ms]
(fail) isReplyListenerDaemonProcess against real processes > #given live children with and without the daemon marker #when probing their self-reported pids #then only the marked child is the daemon and a dead pid is not [65.18ms]
(fail) mcp-oauth storage > should save tokens in per-server hash files and set 0600 permissions [3.36ms]
(fail) darwin process start time > #given the current pid #when the probe and /bin/ps are both consulted #then they report the same instant [44.98ms]
(fail) subprocess lock holder lifecycle > #given a wrapper that spawns the hold-mode worker and SIGKILLs itself once entered #when the wrapper dies #then the ORIGINAL worker is terminal within the bound [178.13ms]
(fail) config source discovery > loads skills from ~/ sources path [2.32ms]
(fail) mcp-oauth storage > should save tokens in per-server hash files and set 0600 permissions [1.72ms]
(fail) config source discovery > loads skills from ~/ sources path [2.03ms]
(fail) resolvePromptAppend > (unnamed) [1.37ms]
(fail) runTmuxCommand > #given cmux environment #when run #then delegates through cmux tmux compatibility command [854.82ms]
(fail) createToolExecuteBeforeHandler > #given Bash has an active tool cwd #when handler runs #then PreToolUse receives that cwd [2.79ms]
(fail) createToolExecuteBeforeHandler > #given Bash lacks an explicit cwd but session has a tracked worktree #when handler runs #then PreToolUse receives the tracked worktree [1.16ms]
(fail) createToolExecuteBeforeHandler > #given denial toast rejects with a non-Error value #when hook denies #then the hook denial still wins [1.11ms]
```

</details>
