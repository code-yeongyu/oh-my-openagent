# PR #7058: parent revalidation QA

## What changed

`createBtwParentValidator()` no longer caches a successful remote parent lookup. A persisted BTW side that is adopted again now performs the same parent check again unless the parent is already known deleted or currently present in local state.

The regression starts with a non-local parent returning `exists`, then simulates its remote deletion by returning `missing` for the second adoption. The original PR head failed this test because its `validatedSessionIDs` success cache returned `true` without issuing the second remote lookup. The fixed validator returns `false` and calls `fetchStatus` twice.

## Commands and results

| Command | Result | Evidence |
|---|---|---|
| `git -c protocol.file.allow=always submodule update --init --recursive` | PASS. Initialized the task worktree's required submodules without touching another worktree. | Environment preparation only |
| `bun install --frozen-lockfile` | PASS after submodule initialization. | Environment preparation only |
| `bun test packages/omo-opencode/src/features/btw-side/tui-parent-validator.test.ts` before the implementation change | Expected RED: the new assertion expected `false` and received cached `true`. | `01-red-parent-validator.log`, `01-red-summary.txt` |
| `bun test packages/omo-opencode/src/features/btw-side/tui-parent-validator.test.ts` after the implementation change | PASS: 2 pass, 0 fail. | `02-green-focused-test.log`, `02-green-summary.txt` |
| `git diff --check` | PASS: no whitespace errors. | `03-diff-check.log` |
| `bun run typecheck` | PASS across root, scripts, and all workspace packages including `omo-opencode`. | `04-typecheck.log` |
| `bun run build` | PASS: all build stages completed. | `06-build.log`, `06-build-status.log` |
| `bun test` after the required build | PASS: 15,945 pass, 13 platform/environment skips, 0 fail. | Recorded result from the completed command; the large raw harness log is intentionally omitted from the review payload. |
| `bash .agents/skills/opencode-qa/scripts/tui-smoke.sh --self-test` | PASS: real OpenCode 1.18.18 TUI rendered under tmux, accepted a typed sentinel, cleaned up, and left the host DB count at 7,584. | `08-opencode-tui-smoke.log` |
| `node script/qa/web-terminal-visual-qa.mjs --self-test` | PASS: xterm assets and real PTY ANSI/CJK path work. | `09-web-terminal-self-test.log` |
| `node script/qa/web-terminal-visual-qa.mjs ... --command "opencode <task-worktree>"` with isolated XDG directories and `file://<task-worktree>` registered in both OpenCode plugin configs | PASS: the task worktree's local plugin rendered in the real xterm.js browser terminal. The visual capture shows the OMO Sisyphus agent surface and the OpenCode prompt. The PTY and browser were killed by the tool; the host DB count stayed 7,584 before and after. | `12-local-plugin-web-terminal-final/terminal.png`, `12-local-plugin-db-receipt.txt` |
| `node packages/shared-skills/skills/visual-qa/scripts/visual-qa.mjs tui-check ... --cols 120` | PASS: 32 lines at 120 columns, no overflow, no border misalignment, and no wide-character drift. | `13-final-tui-width-check.json` |

The first full-suite run happened after restoring generated installer output that the repository build refreshes. It exposed the existing generated-installer version check prerequisite. Re-running the suite after the required `bun run build` passed with 0 failures; no production change was made for that unrelated generated artifact.

## Why this is enough

The failing-first test exercises the exact stale-success branch identified in review and proves a later adoption observes the remote deletion. Typecheck, a full build, and the complete Bun suite validate the repository graph. Isolated OpenCode QA independently proves the real TUI still boots and renders the task worktree plugin, while both the tmux smoke and xterm.js browser capture prove no session was written to the real OpenCode database.

## What was omitted

- No provider credential, authentication header, or real model request was used.
- The full raw `bun test` transcript is omitted from the committed review payload because it is multi-megabyte and contains no failures; its exact final count is recorded above.
- The isolated XDG sandbox was removed after each live QA run. No temporary server, tmux session, browser, or PTY remains.
