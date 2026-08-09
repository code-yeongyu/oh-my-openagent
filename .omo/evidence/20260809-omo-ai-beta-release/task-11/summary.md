# Task 11 - isolated install and runtime smoke

Date: 2026-08-09
Plan: `.omo/plans/omo-ai-beta-release.md`, todo 11
Package under test: local `omo-ai@0.0.0-dev` tarball built from the task worktree
Tarball size: **2,125,372 bytes** (npm reported 2.1 MB packed / 6.7 MB unpacked, 487 files)

## Results

| # | Scenario | Result | Primary artifacts |
|---|---|---|---|
| 1 | `build:omo-native`, `npm pack`, and tar payload contains `bin/` + `plugin/` | PASS | `01-build-and-pack.txt` |
| 2 | Fresh-prefix install; packaged `omo --version`, `doctor`, `ulw-loop status --json`, direct plugin shim, repeat/idempotency, and reinstall | PASS | `02-isolated-install-runtime.txt` |
| 3 | Real-pty packaged `omo --help`; `OmO Native` pirate badge absent with positive help/footer controls present | PASS | `03-pirate-badge-pty.raw`, `03-pirate-badge-pty.txt`, `03-pirate-badge-assertions.txt` |
| 4 | REAL plugin load through launcher + HTTP mock provider; `<ultrawork-mode>` visible; in-session `bash` tool resolves packaged `omo-agent-toolkit` and returns valid status JSON; settings byte-identical with no `packages` key | PASS | `04-plugin-load-and-toolkit.txt`, `04-session.stdout.jsonl`, `04-http-requests.jsonl`, `04-session.stderr.txt`, `04-seed-plan.stdout.json` |
| 5 | Live bare registry install fails `ETARGET` and lands no `omo` bin | PASS | `05-live-registry-bare-etarget.txt`, `05-bare-registry.stderr.txt` |
| 6 | Live `omo-ai@beta` installs documented `0.0.0-beta.0` placeholder | PASS | `06-live-registry-beta-placeholder.txt` |
| 7 | Published `oh-my-openagent@4.19.4` followed by local omo-ai tarball fails `EEXIST`, naming `bin/omo` | PASS | `07-eexist-pre-rename-root.txt`, `07-eexist.stderr.txt` |
| 8 | Packed current root package has five aliases and no `omo`; root tarball + omo-ai tarball coexist with all six expected bins and packaged `omo --version` succeeds | PASS | `08-current-root-coexistence.txt` |
| 9 | Mock server dead, every recorded mktemp root removed, no `omo-ai-task11-*` leftovers | PASS | `09-cleanup-receipts.txt` |

## Key observables

- Plugin load: `04-session.stdout.jsonl` contains the injected `<ultrawork-mode>` custom message from the packaged OMO extension. The same directive is visible in `04-http-requests.jsonl`, proving it reached the mock provider request.
- Toolkit path: the captured `bash` tool result names `<isolated-prefix>/lib/node_modules/omo-ai/plugin/runtime/agent-toolkit/omo-agent-toolkit` and contains parseable `{"ok":true,...}` status JSON.
- Settings isolation: the plugin-load scenario compares `settings.json` byte-for-byte before/after and verifies the `packages` property remains absent.
- Pirate badge: `03-pirate-badge-pty.txt` contains the packaged launcher banner, `Usage:`, `Extension CLI Flags:`, and `Built-in Tool Names:` as positive capture controls; `OmO Native` is absent.
- Registry beta gate: live bare install stderr contains `ETARGET` / `No matching version found for omo-ai@*`; live `@beta` resolves to `0.0.0-beta.0` before the first product beta release.
- Collision: npm reports `EEXIST` at the isolated prefix's `bin/omo` after installing published `oh-my-openagent@4.19.4`.
- Coexistence: the current root tarball exposes exactly `lazycodex`, `lazycodex-ai`, `oh-my-opencode`, `oh-my-openagent`, and `omo-agent-toolkit`; omo-ai adds `omo`.

## Cleanup receipts

Each scenario transcript records its own `rm -rf` receipt. The mock server PID was terminated, waited/reaped, and verified with failing `kill -0`. `09-cleanup-receipts.txt` removes the long-lived install prefix, isolated agent/home/XDG roots, and tarball directory, then confirms no known task-11 mktemp paths remain.

## Non-gating attempt notes

- `01-build-and-pack.txt` records an initial `build:omo-native` failure caused by the concurrently running `test:codex` lane replacing `packages/lsp-daemon/node_modules` during `npm ci`; the immediate retry completed and produced the tested tarball.
- `04-attempt1-parser-failure.txt` records a QA-parser bug after the runtime proof itself ran: it included a trailing shell status annotation in a JSON parse. The mock process and temp root were cleaned.
- `04-attempt2-cleanup-shell-scope.txt` records a cleanup assertion executed inside a pipeline subshell, which could not `wait` on the parent shell's server child. The outer trap reaped it. `04-run-plugin-load.sh` is the corrected final driver and `04-plugin-load-and-toolkit.txt` is the gating PASS run.
- `05-attempt1-default-npm-cache.txt` records the first bare-registry run before npm cache isolation was added; its exact debug log was removed. The gating rerun places npm cache/logs under the removed mktemp root.

Overall result: **PASS - every approved todo-11 scenario and the additional pirate-badge pty directive passed with captured artifacts and cleanup receipts.**
