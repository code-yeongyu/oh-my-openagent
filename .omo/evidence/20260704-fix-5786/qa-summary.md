# QA Evidence: fix 5786

## What Was Tested

- Failing-first regression: `bun test packages/omo-opencode/src/cli/doctor/checks/tui-plugin-config.test.ts -t "passes when tui.json contains the package entry and a tuple plugin entry"`.
- Final doctor suite: `bun test packages/omo-opencode/src/cli/doctor`.
- Typecheck: `bun run typecheck`.
- No-excuse TypeScript rule check: `bun /Users/yeongyu/.agents/skills/omo-programming/scripts/typescript/check-no-excuse-rules.ts packages/omo-opencode/src/cli/doctor/checks/tui-plugin-config.ts packages/omo-opencode/src/cli/doctor/checks/tui-plugin-config.test.ts`.
- Real-surface doctor proof: isolated `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, and `OPENCODE_CONFIG_DIR`; wrote `opencode.json` with `["oh-my-openagent"]` and `tui.json` with `["oh-my-openagent", ["./badge.tsx", {"label":"custom"}]]`; ran `bun packages/omo-opencode/src/cli/index.ts doctor --platform opencode --json`.

## What Was Observed

- RED proof: `red-tuple-regression.log` shows the new regression failed on current code with `Expected: "pass"` and `Received: "warn"`.
- GREEN proof: `green-tuple-regression.log` shows the same named regression passed after the guard fix.
- Final doctor suite: `doctor-suite-final-2.log` shows `159 pass`, `0 fail`.
- Final typecheck: `typecheck-final-2.log` exits 0 across repo package typechecks.
- No-excuse rules: `no-excuse-rules-final.log` shows `No violations in 2 file(s).`
- Isolated doctor proof: `isolated-doctor-final/tui-plugin-result.json` shows the `TUI Plugin` check status is `pass`, message is `Server and TUI plugin entries are both registered`, and `issues` is empty.
- `isolated-doctor-final/assertion.txt` shows `PASS isolated doctor tuple proof`; `isolated-doctor-final/missing-warning-grep.txt` is empty, proving the false `TUI plugin entry missing` warning did not appear.

## Why It Is Enough

- The regression exactly models issue #5786: a valid OMO package entry plus a tuple-style TUI plugin entry.
- The red run proves the defect existed on this HEAD before production code changed.
- The green run, full doctor suite, and typecheck prove the minimal guard fix preserves existing doctor behavior.
- The isolated CLI doctor run exercises the user-facing doctor surface against real JSON config files, not only the unit helper.

## What Was Omitted

- No full design split was made for `tui-plugin-config.ts`, even though it is a pre-existing oversized file, because issue #5786 was explicitly scoped as a pure mechanical bug fix with zero design decisions.
- No GitHub issue comment was posted.
- No package version was changed.
- No secrets, auth headers, or private environment dumps were captured.

## Setup Notes

- Initial `bash script/agent/setup.sh` failed because `bun` was not on PATH in the shell.
- Rerun with `PATH=/Users/yeongyu/.bun/bin:$PATH` installed dependencies but hit local-file submodule protocol restrictions.
- Rerun with environment-only `GIT_ALLOW_PROTOCOL=file:https:ssh:git` initialized the local submodule fixtures, then failed during strict Codex plugin build materialization for the frontend `designpowers` reference. The requested OpenCode doctor tests and real-surface proof above completed independently.
