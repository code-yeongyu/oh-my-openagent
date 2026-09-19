# PR #7823 local refresh evidence

## Integration

Exact PR head: `c16b92b3ed6e92aae4c574fb53cb561f864bdf84`.
Merge head: `cfdaa1d16d25d6152410dea514fd978acfd62bab` (origin/dev, also confirmed by read-only ls-remote).
Branch: `maintenance/7458-refresh-20260913-st01a09b5e`.

Command: `git merge origin/dev --no-commit --no-ff`, with command-scoped identity and no commit created.
Observed: `Automatic merge went well; stopped before committing as requested`.
At the initial handoff, no commits, pushes, PR updates, or user identity configuration changes had been made.

The PR-specific source diff remains three production files plus one regression test (27 additions, 3 deletions): normalize tuple entries through getPluginEntryName in plugin-entry.ts/local-dev-path.ts, type config entries as PluginEntry[], and verify a preceding unrelated tuple does not hide the pinned package. No production edits were needed during refresh. Upstream has no changes to these three production files since e0746bcbc.

## Commands and results

Bun was the explicitly selected 1.4.0 binary (34cbb9a40), not host Bun. Node was v24.18.0. Both selected binary directories were prepended to PATH for validation.

| Command | Actual result | Capture |
| --- | --- | --- |
| `bun test --timeout 20000 packages/omo-opencode/src/hooks/auto-update-checker/checker` | 41 pass, 0 fail, 71 assertions, one run | checker-tests.txt |
| `./node_modules/.bin/tsgo --noEmit -p packages/omo-opencode/tsconfig.json` | exit 0, no diagnostics | compiler.txt |
| `bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod` | exit 0, 2001 modules, 5.88 MB | adapter-build.txt |
| `node --check .omo/evidence/20260913-7458-refresh/replay.mjs` | exit 0 | replay.mjs |
| Replay below | real OpenCode 1.18.30: healthy server, tuple options delivered, matching session.created on SSE and checker hook decisions | result.json, decision-sanitized.json, sse-sanitized.txt, server-sanitized.txt |
| `bun install --frozen-lockfile` | dependencies installed, implicit prepare/full build failed at frontend submodule materialization | full-build-blocker.txt |
| `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always bun run build` | exit 0 on Bun 1.4.0 and Node 24; complete root build passed | full-build-fixed.txt |

LSP requests for all four PR source/test files were rejected because this child tool restricts paths to its original working directory. The actual adapter compiler above provides the diagnostic check instead. An initial compiler invocation guessed a nonexistent tsgo.js entry; it was corrected to the installed .bin/tsgo executable, which passed. The initial refresh suite passed without test changes; the later P1 validation is recorded below.

## Real OpenCode QA and isolation

opencode-qa Case B. A local isolated probe was used; Docker was available but not used. The historical probe was inspected and reused, bundling the integrated checker source. The historical shell drivers were not reused: they contain sleeps/polling, suppressed errors, and missing assertions.

The real server loads the probe as a tuple plugin with a marker option; its server factory asserts the marker. Before POST /session, the driver subscribes to server.connected/session.created and the probe's atomic completion-file rename. It checks the SSE session ID against the HTTP-created session, then asserts both checker results. Bounded timeouts are failure guards, not synchronization delays.

The checker probe uses two separate synthetic config directories: an unrelated tuple preceding oh-my-openagent@4.19.4, and an unrelated tuple preceding a local file tuple. Both execute inside the real session.created handler. The first resolves the pinned entry; the second reports local development mode. The checker fixtures are separate from OpenCode's own loaded-plugin config, so no external npm plugin needs downloading or executing. This proves the exact checker seam and real tuple plugin loading, not a full published-plugin installation.

Final accepted run: isolated HOME, OPENCODE_TEST_HOME, config directory, TMPDIR, all four XDG roots, and a new project outside every checkout. The child environment is allowlisted and contains no inherited provider credentials or personal config. The isolated DB path is asserted under XDG_DATA_HOME and contains one session. Host DB is queried only using sqlite3 -readonly: **8102 before, 8102 after** (isolation.json). Server termination is awaited. Server binds loopback; its captured warning notes no server password was configured.

Three QA driver executions: first stopped before server start because installed --help writes to stderr; second passed functional assertions but used a worktree-local sandbox and is not accepted as final isolation evidence; third corrected sandbox placement and passed all assertions. Published captures are only from the third run.

## Replay

From the preserved worktree, with dependencies installed, select absolute paths to actual Bun 1.4.0, Node 24, the real OpenCode executable, and the host DB. No fallback is allowed; versions are asserted by the driver.

```sh
export QA_BUN="$(command -v bun)" # must be Bun 1.4.0
export QA_OPENCODE="$(command -v opencode)"
export QA_HOST_DB="$HOME/.local/share/opencode/opencode.db"
node .omo/evidence/20260913-7458-refresh/replay.mjs /tmp/tuple-refresh-private-captures
```

Use a fresh private output directory. The driver preserves raw captures and its external sandbox for inspection; sandbox-private.txt locates it. Never stage those outputs directly. Published captures replace sandbox/worktree/host paths with placeholders, retain synthetic IDs and actual decisions, and omit raw private logs, configuration, and auth values.

## Limitations

The initial root build failed on inherited local-file submodule URLs. A subsequent full build passed with a command-scoped file-transport setting, without changing common Git configuration. Adapter compiler and bundle also passed independently. No whole-repository test matrix, model prompt, TUI, npm upgrade download, or full-plugin update orchestration was exercised locally. Unrelated generated artifacts from the full build remain unstaged.

`git diff --cached --check` reports inherited upstream evidence whitespace; comparison against origin/dev also reports whitespace in the PR's historical committed captures. These were not introduced or rewritten here. New artifacts are separately audited. No unrelated tracked generated drift was present after the scoped validators; generated untracked/private output is not staged.

## P1 shared-barrel follow-up

The three added helper/type imports now use the shared barrel as requested.
The first isolated run returned 40 pass / 1 fail because the existing profile
path assertion only normalized `/private/var`, not the equivalent `/tmp` and
`/private/tmp` spellings. The helper now canonicalizes both compared existing
paths with `realpathSync`. The original input remains unchanged and the test
still requires the exact configured file; no test or assertion was removed.

After that correction, one complete checker run passed all 41 tests.
Adapter compilation, bundle build and the same real OpenCode replay passed.
The host session count remained unchanged and the pinned/local tuple decisions
were correct.

- [Initial failure](p1-validation-failed.txt)
- [Successful test, compiler, build and replay output](p1-validation-passed.txt)
- [Actual checker decisions, SSE and isolation receipt](p1-captures.json)

The published failure capture normalizes trailing console whitespace.
The original capture remains local; failure text and assertions are preserved.
