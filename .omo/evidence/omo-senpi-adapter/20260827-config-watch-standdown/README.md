# config-watch duplicate-load stand-down — live Senpi QA evidence

Change under test: `packages/omo-senpi/src/components/config-watch/index.ts`
(deferred/coalesced READY re-registration + superseded-instance stand-down),
PR #7420, mitigating issue #7419.

## What was tested

`dual-load-qa.mjs` (this directory) drives the REAL senpi binary
(`node_modules/.bin/senpi`, engine `2026.8.26-2` — the same engine version as the
crash report) through three lanes. It reuses the sanctioned isolation harness
exported by `packages/omo-senpi/scripts/qa/drive.mjs` (`createSandbox`,
`seedSandbox`, `credentialDigest`): every lane gets a throwaway
`SENPI_CODING_AGENT_DIR`, isolated `HOME`/`USERPROFILE`/XDG dirs, the local mock
provider (`--provider omo-mock --model mock-1`, `PI_OFFLINE=1`), and no real
credentials.

Each lane stages the COMPLETE generated plugin tree (extensions incl.
`omo-task.js` and siblings, skills, staged `runtime/`, manifest) via a full
`cpSync` of `packages/omo-senpi/plugin`, so every component registers; the
pre-fix lanes then overlay ALL generated extension bundles from the parent of
the fix commit (`c45968dfc~1`), keeping the crashing extension a pure
single-generation artifact. Lanes claiming a healthy lifecycle additionally
assert that NO `component registration failed` line appears in the output
(`registrationFailure: false` in `final.json`), so a partially initialized
extension cannot pass as a live probe.

| Lane | Setup | Proves |
|---|---|---|
| `lane1-single-load` | fixed plugin loaded once via settings `packages` | fix does not regress the normal single-instance lifecycle (all components registered, no registration failures) |
| `lane2-dual-fixed` | fixed plugin via `packages` + second fixed copy via `--extension` | duplicate load degrades gracefully: stand-down warning, session completes, no registration failures |
| `lane3-dual-prefix` | complete PRE-FIX plugin (all bundles from `c45968dfc~1`) in both positions | failing-first: reproduces the reported `RangeError: Maximum call stack size exceeded` from `rebuildWatchers` |

Run with: `node .omo/evidence/omo-senpi-adapter/20260827-config-watch-standdown/dual-load-qa.mjs`

Every terminal outcome is persisted to `final.json` before exit: a missing
senpi binary records `SKIP` (checked before anything is staged), any setup or
runtime error (shallow checkout breaking the git bundle extraction, copy
failure, ...) records `FAIL` with the error reason and cleans `.stage`, and the
aggregate PASS verdict includes both real-agent-dir untouched checks. All four
paths were exercised against this script: forced SKIP (`SENPI_BIN=/nonexistent`),
forced setup failure (`PREFIX_REVISION=deadbeef…`), and two full green runs.
## What was observed

Final JSON: `final.json` (verbatim driver output). Summary:

- `lane1-single-load` PASS — exit 0, no stand-down warning, no RangeError, no component registration failures (`lane1-single-load.output.txt`).
- `lane2-dual-fixed` PASS — exit 0, output contains `omo config-watch superseded by another omo extension instance; standing down`, no RangeError, no component registration failures (`lane2-dual-fixed.output.txt`).
- `lane3-dual-prefix` PASS — output contains `OmO exiting due to uncaughtException: RangeError: Maximum call stack size exceeded` with the `rebuildWatchers` frames from the issue report (`lane3-dual-prefix.output.txt`). Note: senpi exits 0 even from its uncaughtException handler, so the lane pins the RangeError text, not the exit code.
- Isolation: `realSenpiUntouched: true` and `realOmoAgentUntouched: true` — credential digests (`auth.json`, `models.json`, `settings.json` minus volatile stamps, `trust.json`) of the real `~/.senpi/agent` and `~/.omo/agent` are byte-identical before and after all lanes. Sandbox roots (`%TEMP%\omo-senpi-qa-*`) are deleted by the driver in a `finally` block; each lane's sandbox agent-dir path is recorded in `final.json`.

## Package gate

### Green run in a supported environment (Linux)

The mandatory chained gate was run to completion on WSL Ubuntu 22.04.4 LTS with
the CI-pinned toolchain (bun `1.4.0`, node `v24.6.0`) against a fresh clone of
this exact branch head (`874f807920d9347d75ce3925b7cfadfd1d6a39e0`):

```
TOOLCHAIN: bun 1.4.0 / node v24.6.0 / Ubuntu 22.04.4 LTS
HEAD: 874f807920d9347d75ce3925b7cfadfd1d6a39e0
bun run test:senpi -> GATE_EXIT=0
  bun test packages/omo-senpi: 2404 pass / 7 skip / 0 fail (2411 tests, 321 files)
  resolve-evidence-dir contract: 10 pass / 0 fail
```

Full verbatim output: `linux-gate-test-senpi.log` (this directory). The 7 skips
are the suite's own Windows-only process-mode guards. This confirms the 14
`components/thread/*` failures recorded below are Windows-host environment
artifacts, not defects: the identical files pass 0-fail on Linux.

### Windows host runs (initial, superseded by the Linux run above)

- `bun test packages/omo-senpi/src/components/config-watch/` — 36 pass / 0 fail (includes the two new regression tests: identity-guarded synchronous echo host, deferral/coalescing of the READY re-registration).
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` — clean.
- `bun test ./.agents/skills/senpi-qa/scripts/resolve-evidence-dir.test.mjs` — 10 pass / 0 fail.
- `bun run test:senpi` (chained form) could not complete on this Windows host: its first step `build:lsp-daemon` fails with `'C:\Program' is not recognized` — the unquoted `process.execPath` + `shell: true` bug in `packages/lsp-daemon/scripts/build.mjs`, filed separately as issue #7421 and unrelated to this change. The gate's steps were therefore run individually: lsp-daemon dist built with the same tsc/bun/stamp steps (quoted), then `build:ast-grep-mcp`, `build:senpi-plugin:stage`, `tsgo`, and `bun test packages/omo-senpi`.
- `bun test packages/omo-senpi` — 2383 pass / 14 fail / 14 skip. All 14 failures are in `src/components/thread/` (`receipts.test.ts`, `mailbox.test.ts`) with the identical `EPERM: operation not permitted, fsync` signature from `atomicWrite`/`persist`; they reproduce identically on the unmodified upstream files in isolation on this host (Windows filesystem denies `fsyncSync` on a read-opened fd in `%TEMP%`), and none of them touch config-watch. The ubuntu `senpi-compatibility` CI leg is the arbiter for those.

## Why it is enough

The three lanes cover the full behavior matrix of the change against the real
engine at the reported version: unchanged single-instance lifecycle, graceful
dual-load degradation (the fix), and a faithful reproduction of the original
crash on the pre-fix bundle proving the mechanism (identity-guard ping-pong
through `rebuildWatchers`) is what the fix addresses. Unit-level regression
coverage for the same mechanism lives in
`packages/omo-senpi/src/components/config-watch/index.test.ts`.

## What was omitted

- Raw lane outputs are committed verbatim (`lane*.output.txt`); they contain
  only sandbox temp paths, mock-provider text, and the crash stack — no
  credentials, tokens, or real user data (all lanes run `PI_OFFLINE=1` with no
  `auth.json`).
- The interactive TUI path was not driven; the crash and the fix both live on
  the extension-load/session-start path, which `-p` print mode exercises
  identically (confirmed by the lane3 reproduction matching the issue trace).
